import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

const require = createRequire(import.meta.url);

// Enable clean TypeScript + `@/` alias loading for Node native test runner
const projectRoot = process.cwd();
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('@/')) {
    request = path.join(projectRoot, 'src', request.slice(2));
  }
  return originalResolveFilename.call(this, request, parent, ...rest);
};

require.extensions['.ts'] = function (mod, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
    fileName: filename,
  });
  return mod._compile(compiled.outputText, filename);
};

const {
  validateAndFormatPhone,
  DemoQueryParamsSchema,
  LeadSubmissionSchema,
  canTransitionLeadStatus,
  sanitizeToGsm7,
  isStrictlyGsm7,
  isOptOutKeyword,
  encodeCompactUuid,
  decodeLeadIdentifier,
  formatCompactCustomerSms,
  formatCompactOwnerAlertSms,
  LEAD_STATUS_RANK,
} = require('../src/core/domain/index.ts');

const { encryptTenantSecret, decryptTenantSecret } = require(
  '../src/adapters/security/token-crypto.ts'
);
const { SlidingWindowRateLimiter } = require(
  '../src/adapters/security/sliding-window-rate-limiter.ts'
);
const { MetaWhatsAppAdapter } = require(
  '../src/adapters/providers/meta-whatsapp.adapter.ts'
);
const { AfricasTalkingAdapter } = require(
  '../src/adapters/providers/africas-talking.adapter.ts'
);
const { DemoSecurityService } = require(
  '../src/services/demo-security.service.ts'
);
const { LeadDispatchService } = require(
  '../src/services/lead-dispatch.service.ts'
);
const { WebhookProcessorService } = require(
  '../src/services/webhook-processor.service.ts'
);

/**
 * Stateful in-memory repository implementing LeadRepository + TenantResolver
 * with PostgreSQL-equivalent monotonic status triggers, dedup, opt-outs & webhook ledger.
 */
class InMemoryLeadRepository {
  constructor() {
    this.tenants = new Map();
    this.leads = new Map();
    this.dispatches = [];
    this.conversations = [];
    this.webhookKeys = new Set();
    this.optOuts = new Set();
    this.auditLogs = [];
  }

  seedTenant(tenant) {
    this.tenants.set(tenant.slug, tenant);
  }

  async resolveBySlug(slug) {
    return this.tenants.get(slug) || null;
  }

  async resolveByWhatsAppPhoneNumberId(phoneNumberId) {
    for (const t of this.tenants.values()) {
      if (t.whatsapp_phone_number_id === phoneNumberId) return t;
    }
    return null;
  }

  async ingestLeadAtomic(params) {
    let tenant = this.tenants.get(params.organizationSlug);
    if (!tenant) {
      tenant = {
        id: crypto.randomUUID(),
        slug: params.organizationSlug,
        name: params.organizationName,
        niche: params.niche,
        owner_dialer_phone: params.ownerPhone || params.phoneE164,
        dispatch_mode: 'PARALLEL_DEMO',
        whatsapp_phone_number_id: null,
        whatsapp_access_token_encrypted: null,
        at_sender_id: null,
        primary_color: params.primaryColor,
        settings: {
          auto_dispatch_whatsapp: true,
          auto_dispatch_sms: true,
          dedup_window_minutes: 10,
          waterfall_sms_delay_ms: 25,
        },
      };
      this.tenants.set(tenant.slug, tenant);
    }

    const dedupCutoff = Date.now() - (tenant.settings?.dedup_window_minutes || 10) * 60 * 1000;
    for (const lead of this.leads.values()) {
      if (
        lead.organization_id === tenant.id &&
        lead.phone_e164 === params.phoneE164 &&
        lead.execution_mode === params.executionMode &&
        lead.created_at_ms > dedupCutoff
      ) {
        return {
          lead_id: lead.id,
          is_duplicate: true,
          is_opted_out: false,
          existing_status: lead.status,
          tenant_config: tenant,
        };
      }
    }

    const id = crypto.randomUUID();
    const isOptedOut =
      this.optOuts.has(`global:${params.phoneE164}`) ||
      this.optOuts.has(`${tenant.id}:${params.phoneE164}`);

    this.leads.set(id, {
      id,
      organization_id: tenant.id,
      raw_name: params.rawName,
      phone_e164: params.phoneE164,
      service_requested: params.serviceRequested,
      status: 'PENDING',
      execution_mode: params.executionMode,
      consent_accepted: params.consentAccepted,
      privacy_notice_version: params.privacyNoticeVersion,
      owner_clicked_call_at: null,
      owner_clicked_wa_at: null,
      customer_replied_at: null,
      sla_escalated_at: null,
      created_at_ms: Date.now(),
    });

    return {
      lead_id: id,
      is_duplicate: false,
      is_opted_out: isOptedOut,
      existing_status: null,
      tenant_config: tenant,
    };
  }

  async updateLeadAfterDispatch(leadId, status, firstResponseLatencyMs, dbLatencyMs) {
    const lead = this.leads.get(leadId);
    if (!lead) return;
    if (LEAD_STATUS_RANK[status] >= LEAD_STATUS_RANK[lead.status]) {
      lead.status = status;
    }
    lead.first_response_latency_ms = firstResponseLatencyMs;
    lead.db_latency_ms = dbLatencyMs;
  }

  async getLeadStatus(leadId) {
    const lead = this.leads.get(leadId);
    if (!lead) return null;
    return lead;
  }

  async recordDispatch(params) {
    this.dispatches.push({ ...params, acknowledged_at: null });
  }

  async recordConversation(params) {
    this.conversations.push({ ...params });
  }

  async applyWebhookEventAtomic(params) {
    const key = `${params.provider}:${params.providerMessageId}:${params.eventStatus.toUpperCase()}`;
    if (this.webhookKeys.has(key)) {
      return { duplicate: true, leadId: null };
    }
    this.webhookKeys.add(key);

    const conv = this.conversations.find((c) => c.externalMessageId === params.providerMessageId);
    const disp = this.dispatches.find((d) => d.providerMessageId === params.providerMessageId);
    const leadId = conv?.leadId || disp?.leadId || null;

    if (leadId && params.leadTargetStatus) {
      const lead = this.leads.get(leadId);
      if (lead && LEAD_STATUS_RANK[params.leadTargetStatus] >= LEAD_STATUS_RANK[lead.status]) {
        lead.status = params.leadTargetStatus;
      }
    }
    return { duplicate: false, leadId };
  }

  async recordInboundWebhookMessage(params) {
    const key = `${params.provider}:${params.providerMessageId}:INBOUND_MESSAGE`;
    if (this.webhookKeys.has(key)) {
      return { duplicate: true, leadId: null };
    }
    this.webhookKeys.add(key);

    const matchingLeads = Array.from(this.leads.values())
      .filter(
        (l) =>
          l.phone_e164 === params.senderPhoneE164 &&
          (!params.organizationIdFilter || l.organization_id === params.organizationIdFilter)
      )
      .sort((a, b) => b.created_at_ms - a.created_at_ms);

    const lead = matchingLeads[0];
    if (!lead) return { duplicate: false, leadId: null };

    this.conversations.push({
      leadId: lead.id,
      organizationId: lead.organization_id,
      channel: params.channel,
      direction: 'inbound',
      externalMessageId: params.providerMessageId,
      messageBody: params.messageBody,
      deliveryStatus: 'RECEIVED',
    });

    if (LEAD_STATUS_RANK.CUSTOMER_REPLIED >= LEAD_STATUS_RANK[lead.status]) {
      lead.status = 'CUSTOMER_REPLIED';
      lead.customer_replied_at = new Date().toISOString();
    }

    return { duplicate: false, leadId: lead.id };
  }

  async recordOwnerClickSla(params) {
    const lead = this.leads.get(params.leadId);
    if (!lead) return null;
    const tenant = Array.from(this.tenants.values()).find((t) => t.id === lead.organization_id);
    if (params.channel === 'call') {
      lead.owner_clicked_call_at = lead.owner_clicked_call_at || new Date().toISOString();
      this.auditLogs.push({ action: 'OWNER_CLICKED_CALL', leadId: lead.id });
    } else {
      lead.owner_clicked_wa_at = lead.owner_clicked_wa_at || new Date().toISOString();
      this.auditLogs.push({ action: 'OWNER_CLICKED_WA', leadId: lead.id });
    }
    return {
      leadId: lead.id,
      organizationId: lead.organization_id,
      organizationName: tenant?.name || 'Demo Corp',
      customerName: lead.raw_name,
      customerPhoneE164: lead.phone_e164,
      serviceRequested: lead.service_requested,
    };
  }

  async recordPhoneOptOut(params) {
    const scope = params.organizationId ? `${params.organizationId}:${params.phoneE164}` : `global:${params.phoneE164}`;
    this.optOuts.add(scope);
  }

  async claimOverdueSlaLeads(params) {
    const now = Date.now();
    let expiredCount = 0;
    const escalations = [];

    for (const lead of this.leads.values()) {
      if (
        lead.execution_mode !== 'LIVE_DISPATCH' ||
        lead.owner_clicked_call_at ||
        lead.owner_clicked_wa_at ||
        lead.customer_replied_at
      ) {
        continue;
      }
      if (!['DISPATCHED_TO_OWNER', 'SENT', 'WHATSAPP_SENT', 'DELIVERED'].includes(lead.status)) {
        continue;
      }

      if (now - lead.created_at_ms > params.expireAfterSeconds * 1000) {
        lead.status = 'EXPIRED_NO_RESPONSE';
        expiredCount++;
        continue;
      }

      if (!lead.sla_escalated_at && now - lead.created_at_ms > params.escalateAfterSeconds * 1000) {
        lead.sla_escalated_at = new Date().toISOString();
        const tenant = Array.from(this.tenants.values()).find((t) => t.id === lead.organization_id);
        escalations.push({
          lead_id: lead.id,
          customer_name: lead.raw_name,
          customer_phone_e164: lead.phone_e164,
          service_requested: lead.service_requested,
          created_at: new Date(lead.created_at_ms).toISOString(),
          tenant,
        });
      }
    }

    return { expired_count: expiredCount, escalations: escalations.slice(0, params.limit) };
  }
}

test('1. Domain validation: E.164 normalization, XSS sanitization, GSM-7 SMS, and state machine', () => {
  assert.equal(validateAndFormatPhone('0712 345 678').e164, '+254712345678');
  assert.equal(validateAndFormatPhone('0712 345 678').carrierType, 'safaricom');
  assert.equal(validateAndFormatPhone('0112345678').e164, '+254112345678');
  assert.equal(validateAndFormatPhone('254733111222').e164, '+254733111222');
  assert.equal(validateAndFormatPhone('254733111222').carrierType, 'airtel');
  assert.equal(validateAndFormatPhone('+447911123456').e164, '+447911123456');
  assert.equal(validateAndFormatPhone('123').isValid, false);

  const sanitized = DemoQueryParamsSchema.parse({
    client: '<script>alert("xss")</script>Apex Solar',
    color: 'ff;background:url(evil)',
    phone: '+254712345678',
    niche: 'solar',
    services: 'Solar Audit,<img src=x>,BESS Retrofit',
  });
  assert.ok(!sanitized.client.includes('<') && !sanitized.client.includes('>'));
  assert.equal(sanitized.color, '2563EB');
  assert.deepEqual(sanitized.services, ['Solar Audit', 'img src=x', 'BESS Retrofit']);

  const customerSms = formatCompactCustomerSms({
    customerName: 'Eng. David Maina',
    clientName: 'Davis & Shirtliff Boreholes',
    serviceRequested: 'Turnkey Commercial Borehole (180m–220m) 🚀',
  });
  assert.ok(customerSms.length <= 160);
  assert.equal(isStrictlyGsm7(customerSms), true);
  assert.equal(sanitizeToGsm7('6–8 Teeth “Premium”'), '6-8 Teeth "Premium"');

  const uuid = '5ab212ea-9431-4c51-9cd5-b9265ae1552b';
  const compact = encodeCompactUuid(uuid);
  assert.equal(compact.length, 22);
  assert.equal(decodeLeadIdentifier(compact), uuid);
  assert.equal(decodeLeadIdentifier(uuid.toUpperCase()), uuid);

  assert.equal(isOptOutKeyword('STOP'), true);
  assert.equal(isOptOutKeyword('opt out'), true);
  assert.equal(isOptOutKeyword('Need borehole quote'), false);

  assert.equal(canTransitionLeadStatus('DELIVERED', 'SENT'), false);
  assert.equal(canTransitionLeadStatus('CUSTOMER_REPLIED', 'DELIVERED'), false);
  assert.equal(canTransitionLeadStatus('SENT', 'DELIVERED'), true);
  assert.equal(canTransitionLeadStatus('DELIVERED', 'CUSTOMER_REPLIED'), true);
});

test('2. Security: AES-256-GCM token encryption, HMAC demo signing & sliding-window rate limits', async () => {
  process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const encrypted = encryptTenantSecret('EAA_LIVE_TENANT_TOKEN');
  assert.ok(encrypted.startsWith('enc:v1:'));
  assert.equal(decryptTenantSecret(encrypted), 'EAA_LIVE_TENANT_TOKEN');
  assert.equal(decryptTenantSecret('enc:v1:00:00:deadbeef'), null);

  process.env.DEMO_SIGNING_SECRET = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
  const limiter = new SlidingWindowRateLimiter(null);
  const security = new DemoSecurityService(limiter);

  const minted = security.mintSignedDemoUrl('https://chameleon.example', {
    client: 'Apex Solar',
    color: '0284c7',
    phone: '0712345678',
    niche: 'solar',
    ttlSeconds: 300,
  });
  const params = Object.fromEntries(new URL(minted.url).searchParams.entries());
  assert.equal(security.verifyDemoContext(params).executionMode, 'LIVE_DISPATCH');
  assert.equal(
    security.verifyDemoContext({ ...params, phone: '+254799999999' }).executionMode,
    'SANDBOX_SIMULATION'
  );
  assert.equal(
    security.verifyDemoContext({ ...params, exp: String(Math.floor(Date.now() / 1000) - 10) }).reason,
    'EXPIRED_SIGNATURE'
  );

  for (let i = 0; i < 5; i++) {
    const r = await security.enforceSubmissionRateLimits(`192.168.1.${i}`, '+254711111111');
    assert.equal(r.allowed, true);
  }
  const phoneBlocked = await security.enforceSubmissionRateLimits('192.168.1.99', '+254711111111');
  assert.equal(phoneBlocked.allowed, false);
  assert.equal(phoneBlocked.reason, 'PHONE_RATE_LIMIT');
});

test('3. Providers: Meta Graph API v26.0 retries & Africa Talking sender ID fallback + GSM-7', async () => {
  process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.AFRICASTALKING_API_KEY = 'atsk_test_key';
  process.env.AFRICASTALKING_USERNAME = 'sandbox';

  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  let metaAttempts = 0;
  let atAttempts = 0;

  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init });

    if (String(url).includes('graph.facebook.com')) {
      metaAttempts++;
      if (metaAttempts === 1) {
        return new Response(JSON.stringify({ error: { message: 'Rate limited', code: 4 } }), { status: 429 });
      }
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST123' }] }), { status: 200 });
    }

    if (String(url).includes('africastalking.com')) {
      atAttempts++;
      const bodyStr = String(init.body || '');
      if (atAttempts === 1 && bodyStr.includes('from=BAD_SENDER')) {
        return new Response(
          JSON.stringify({ SMSMessageData: { Message: 'InvalidSenderId', Recipients: [] } }),
          { status: 400 }
        );
      }
      return new Response(
        JSON.stringify({
          SMSMessageData: {
            Recipients: [{ statusCode: 101, status: 'Success', messageId: 'ATXid_FALLBACK_1' }],
          },
        }),
        { status: 200 }
      );
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const tenant = {
      id: 'org-1',
      slug: 'apex-solar',
      name: 'Apex Solar',
      niche: 'solar',
      owner_dialer_phone: '+254712345678',
      dispatch_mode: 'PARALLEL_DEMO',
      whatsapp_phone_number_id: '9988776655',
      whatsapp_access_token_encrypted: encryptTenantSecret('TENANT_WABA_SECRET'),
      at_sender_id: 'BAD_SENDER',
      primary_color: '#0284C7',
      settings: {},
    };

    const metaAdapter = new MetaWhatsAppAdapter({ maxRetries: 1 });
    const waRes = await metaAdapter.send({
      leadId: 'lead-1',
      toPhoneE164: '+254722000111',
      customerName: 'David Maina',
      clientName: 'Apex Solar',
      serviceRequested: '65kWp Grid-Tied Commercial Rooftop',
      tenant,
    });
    assert.equal(waRes.success, true);
    assert.equal(waRes.providerMessageId, 'wamid.TEST123');
    assert.ok(fetchCalls[0].url.includes('/v26.0/9988776655/messages'));
    assert.equal(fetchCalls[0].init.headers.Authorization, 'Bearer TENANT_WABA_SECRET');

    const atAdapter = new AfricasTalkingAdapter({ maxRetries: 0 });
    const smsRes = await atAdapter.send({
      leadId: 'lead-1',
      toPhoneE164: '+254722000111',
      messageBody: 'Turnkey Borehole (180m–220m) quote ready!',
      channel: 'AFRICAS_TALKING_SMS',
      tenant,
    });
    assert.equal(smsRes.success, true);
    assert.equal(smsRes.providerMessageId, 'ATXid_FALLBACK_1');
    assert.equal(smsRes.requestPayload.senderFallbackApplied, true);
    assert.equal(smsRes.requestPayload.message, 'Turnkey Borehole (180m-220m) quote ready!');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('4. E2E Orchestration: Sandbox, PARALLEL_DEMO, Dedup, WATERFALL_PROD, Webhooks, STOP, SLA Click & Cron', async () => {
  process.env.DEMO_SIGNING_SECRET = '111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000';
  process.env.WHATSAPP_APP_SECRET = 'meta-webhook-secret';
  process.env.WHATSAPP_CLOUD_API_TOKEN = 'master-wa-token';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '1000000001';
  process.env.AFRICASTALKING_API_KEY = 'atsk_live_test';
  process.env.AFRICASTALKING_USERNAME = 'sandbox';
  delete process.env.QSTASH_TOKEN;

  const originalFetch = globalThis.fetch;
  const externalCalls = [];
  let msgCounter = 0;

  globalThis.fetch = async (url, init) => {
    msgCounter++;
    externalCalls.push({ url: String(url), body: init?.body });
    if (String(url).includes('graph.facebook.com')) {
      return new Response(JSON.stringify({ messages: [{ id: `wamid.E2E_${msgCounter}` }] }), { status: 200 });
    }
    if (String(url).includes('africastalking.com')) {
      return new Response(
        JSON.stringify({
          SMSMessageData: {
            Recipients: [{ statusCode: 101, status: 'Success', messageId: `ATXid.E2E_${msgCounter}` }],
          },
        }),
        { status: 200 }
      );
    }
    throw new Error(`Unexpected external fetch: ${url}`);
  };

  try {
    const repo = new InMemoryLeadRepository();
    const limiter = new SlidingWindowRateLimiter(null);
    const security = new DemoSecurityService(limiter);
    const metaAdapter = new MetaWhatsAppAdapter({ maxRetries: 0 });
    const atAdapter = new AfricasTalkingAdapter({ maxRetries: 0 });
    const dispatchService = new LeadDispatchService(repo, security, metaAdapter, atAdapter);
    const webhookService = new WebhookProcessorService(repo, repo);

    const metaReq = {
      ipAddress: '41.90.1.10',
      userAgent: 'E2E-Test/1.0',
      appBaseUrl: 'https://chameleon.example',
    };

    // A. Unsigned Sandbox request -> 0 external API calls
    const sandboxRes = await dispatchService.handleLeadIntake(
      {
        fullName: 'Sandbox Tester',
        phone: '0712345678',
        serviceRequested: 'Solar Audit',
        organizationSlug: 'apex-solar',
        consentAccepted: true,
      },
      metaReq
    );
    assert.equal(sandboxRes.httpStatus, 200);
    assert.equal(sandboxRes.body.executionMode, 'SANDBOX_SIMULATION');
    await sandboxRes.backgroundTask;
    assert.equal(externalCalls.length, 0);

    // B. Signed PARALLEL_DEMO flow -> fires WA + Customer SMS + Owner Alert
    const signedUrl = security.mintSignedDemoUrl('https://chameleon.example', {
      client: 'Davis Boreholes',
      color: '059669',
      phone: '0722000999',
      niche: 'borehole',
      ttlSeconds: 600,
    });
    const signedParams = Object.fromEntries(new URL(signedUrl.url).searchParams.entries());

    const liveParallel = await dispatchService.handleLeadIntake(
      {
        fullName: 'Eng. Peter Kamau',
        phone: '0712345001',
        serviceRequested: 'Turnkey Commercial Borehole (180m–220m)',
        organizationSlug: 'davis-boreholes',
        ownerPhone: '+254722000999',
        consentAccepted: true,
        demoContext: signedParams,
      },
      metaReq
    );
    assert.equal(liveParallel.httpStatus, 200);
    assert.equal(liveParallel.body.executionMode, 'LIVE_DISPATCH');
    await liveParallel.backgroundTask;
    assert.equal(externalCalls.length, 3);

    const ownerSmsCall = externalCalls.find((c) => String(c.body).includes('Davis+Boreholes') && String(c.body).includes('%2Fr%2Fc%2F'));
    assert.ok(ownerSmsCall, 'Owner alert SMS should include compact /r/c/ tracking URL');

    // C. Deduplication within 10m window
    const dupRes = await dispatchService.handleLeadIntake(
      {
        fullName: 'Eng. Peter Kamau',
        phone: '+254712345001',
        serviceRequested: 'Turnkey Commercial Borehole (180m–220m)',
        organizationSlug: 'davis-boreholes',
        consentAccepted: true,
        demoContext: signedParams,
      },
      metaReq
    );
    assert.equal(dupRes.body.status, 'DEDUPLICATED');
    assert.equal(externalCalls.length, 3);

    // D. Webhook status progression & out-of-order downgrade protection
    const waConv = repo.conversations.find((c) => c.leadId === liveParallel.body.leadId && c.channel === 'whatsapp');
    const deliveredOutcome = await webhookService.processWhatsAppWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [{ id: waConv.externalMessageId, status: 'delivered' }],
              },
            },
          ],
        },
      ],
    });
    assert.equal(deliveredOutcome.processedEvents, 1);
    assert.equal((await repo.getLeadStatus(liveParallel.body.leadId)).status, 'DELIVERED');

    // Duplicate DELIVERED webhook -> idempotent skip
    const dupWebhook = await webhookService.processWhatsAppWebhook({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { statuses: [{ id: waConv.externalMessageId, status: 'delivered' }] } }] }],
    });
    assert.equal(dupWebhook.duplicateEvents, 1);

    // Delayed SENT webhook arriving AFTER DELIVERED must NOT downgrade status
    await webhookService.processWhatsAppWebhook({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { statuses: [{ id: waConv.externalMessageId, status: 'sent' }] } }] }],
    });
    assert.equal((await repo.getLeadStatus(liveParallel.body.leadId)).status, 'DELIVERED');

    // E. WATERFALL_PROD suppresses SMS when WA delivers in window, sends when undelivered
    const waterfallTenant = {
      id: crypto.randomUUID(),
      slug: 'crown-motors',
      name: 'Crown Motors',
      niche: 'vehicle',
      owner_dialer_phone: '+254733000888',
      dispatch_mode: 'WATERFALL_PROD',
      primary_color: '#DC2626',
      settings: { auto_dispatch_whatsapp: true, auto_dispatch_sms: true, dedup_window_minutes: 10, waterfall_sms_delay_ms: 15 },
    };
    repo.seedTenant(waterfallTenant);
    const crownSigned = security.mintSignedDemoUrl('https://chameleon.example', {
      client: 'Crown Motors',
      color: 'dc2626',
      phone: '0733000888',
      niche: 'vehicle',
      ttlSeconds: 600,
    });
    const crownParams = Object.fromEntries(new URL(crownSigned.url).searchParams.entries());

    const callsBeforeWaterfall = externalCalls.length;
    const wfLead = await dispatchService.handleLeadIntake(
      {
        fullName: 'Alice Wanjiku',
        phone: '0712345002',
        serviceRequested: 'Toyota Land Cruiser Prado TX-L',
        organizationSlug: 'crown-motors',
        consentAccepted: true,
        demoContext: crownParams,
      },
      metaReq
    );
    await wfLead.backgroundTask;
    // WA + Owner Alert + fallback Customer SMS (since no DELIVERED webhook arrived during 15ms) = 3 calls
    assert.equal(externalCalls.length - callsBeforeWaterfall, 3);

    // F. Inbound STOP on Africa's Talking webhook suppresses future customer WA/SMS
    await webhookService.processAfricasTalkingWebhook({
      from: '+254712345002',
      text: 'STOP',
      id: 'ATPid_STOP_1',
    });
    assert.equal((await repo.getLeadStatus(wfLead.body.leadId)).status, 'CUSTOMER_REPLIED');

    const callsBeforeStoppedLead = externalCalls.length;
    const stoppedLead = await dispatchService.handleLeadIntake(
      {
        fullName: 'Alice Wanjiku',
        phone: '0712345002',
        serviceRequested: 'Subaru Outback Limited',
        organizationSlug: 'davis-boreholes',
        consentAccepted: true,
        demoContext: signedParams,
      },
      metaReq
    );
    await stoppedLead.backgroundTask;
    // Only Owner Alert sent; Customer WA and Customer SMS suppressed by STOP registry
    assert.equal(externalCalls.length - callsBeforeStoppedLead, 1);

    // G. 1-Tap SLA Click Tracker + SLA Escalation Sweep
    const clickTarget = await repo.recordOwnerClickSla({
      leadId: liveParallel.body.leadId,
      channel: 'call',
      ipAddress: '41.90.1.1',
      userAgent: 'TestBrowser',
    });
    assert.equal(clickTarget.customerPhoneE164, '+254712345001');

    // Backdate stoppedLead creation by 6 minutes and verify escalation cron sends SLA reminder
    const stoppedRecord = repo.leads.get(stoppedLead.body.leadId);
    stoppedRecord.status = 'DISPATCHED_TO_OWNER';
    stoppedRecord.customer_replied_at = null;
    stoppedRecord.created_at_ms = Date.now() - 360 * 1000;

    const sweep = await dispatchService.runSlaEscalationSweep({
      appBaseUrl: 'https://chameleon.example',
      escalateAfterSeconds: 300,
      expireAfterSeconds: 3600,
    });
    assert.equal(sweep.escalatedCount, 1);
    assert.equal(sweep.expiredCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
