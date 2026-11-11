/**
 * Lead Dispatch Orchestration Service
 * Orchestrates sub-250ms intake, rate limiting, atomic deduplication/persistence,
 * and non-blocking dual-channel dispatch (PARALLEL_DEMO vs WATERFALL_PROD) via waitUntil/QStash.
 */

import {
  formatCompactCustomerSms,
  formatCompactOwnerAlertSms,
  formatSlaEscalationSms,
  getNichePreset,
  isLeadAlreadyDeliveredOrReplied,
  LeadSubmissionSchema,
  normalizeNicheKey,
  toTenantSlug,
  validateAndFormatPhone,
  type ExecutionMode,
  type LeadSubmissionResponse,
  type TelemetryStep,
  type TenantConfig,
} from '@/core/domain';
import type {
  LeadRepository,
  MessagingProvider,
  ProviderDispatchResult,
  SmsDispatchRequest,
  WhatsAppTemplateRequest,
} from '@/core/ports';
import type { DemoSecurityService } from './demo-security.service';

export interface LeadIntakeRequestMeta {
  ipAddress: string;
  userAgent: string;
  appBaseUrl: string;
}

export interface LeadSubmissionOutcome {
  httpStatus: number;
  body: LeadSubmissionResponse;
  backgroundTask?: Promise<void>;
}

export class LeadDispatchService {
  constructor(
    private readonly repository: LeadRepository,
    private readonly demoSecurity: DemoSecurityService,
    private readonly whatsappProvider: MessagingProvider<WhatsAppTemplateRequest>,
    private readonly smsProvider: MessagingProvider<SmsDispatchRequest>
  ) {}

  async handleLeadIntake(
    rawPayload: unknown,
    meta: LeadIntakeRequestMeta
  ): Promise<LeadSubmissionOutcome> {
    const t0 = Date.now();

    // 1. Strict Zod schema validation & XSS sanitization
    const parsed = LeadSubmissionSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return {
        httpStatus: 400,
        body: {
          success: false,
          status: 'FAILED',
          message: 'Invalid lead payload format',
          error: 'Invalid lead payload format',
          details: parsed.error.flatten(),
        },
      };
    }

    const input = parsed.data;

    // 2. E.164 phone normalization (07XX, 01XX, +254, international)
    const tNorm0 = Date.now();
    const customerPhone = validateAndFormatPhone(input.phone);
    if (!customerPhone.isValid) {
      return {
        httpStatus: 422,
        body: {
          success: false,
          status: 'FAILED',
          message:
            'Invalid mobile phone number. Please enter a valid number (e.g. 0712345678 or +254712345678).',
          error:
            'Invalid mobile phone number. Please enter a valid number (e.g. 0712345678 or +254712345678).',
        },
      };
    }
    const normLatencyMs = Date.now() - tNorm0;

    // 3. Sliding-window rate limit check BEFORE any DB write or external API call
    const rateCheck = await this.demoSecurity.enforceSubmissionRateLimits(
      meta.ipAddress,
      customerPhone.e164
    );
    if (!rateCheck.allowed) {
      return {
        httpStatus: 429,
        body: {
          success: false,
          status: 'FAILED',
          message: `Rate limit exceeded (${rateCheck.reason}). Retry in ${rateCheck.retryAfterSeconds}s.`,
          error: `Too many requests. Retry after ${rateCheck.retryAfterSeconds}s.`,
        },
      };
    }

    // 4. Verify Demo HMAC Signature -> determines LIVE_DISPATCH vs SANDBOX_SIMULATION
    const demoVerification = this.demoSecurity.verifyDemoContext(
      input.demoContext || {
        client: input.organizationSlug,
        phone: input.ownerPhone,
        niche: typeof input.metadata?.niche === 'string' ? input.metadata.niche : 'general',
      }
    );

    const executionMode: ExecutionMode = demoVerification.executionMode;
    const sanitized = demoVerification.sanitizedParams;
    const nicheKey = normalizeNicheKey(
      typeof input.metadata?.niche === 'string' ? input.metadata.niche : sanitized.niche
    );
    const nichePreset = getNichePreset(nicheKey, sanitized.client);

    const resolvedOwnerPhone = input.ownerPhone
      ? validateAndFormatPhone(input.ownerPhone).e164 || sanitized.phone
      : sanitized.phone;

    const orgSlug = input.demoContext?.client
      ? toTenantSlug(sanitized.client)
      : input.organizationSlug;

    // 5. Single-roundtrip atomic ingestion + advisory-locked sliding-window dedup
    const tDb0 = Date.now();
    const ingestResult = await this.repository.ingestLeadAtomic({
      organizationSlug: orgSlug,
      organizationName: sanitized.client,
      niche: nicheKey,
      primaryColor: `#${sanitized.color}`,
      ownerPhone: resolvedOwnerPhone,
      allowAutoRegister: true,
      rawName: input.fullName,
      phoneE164: customerPhone.e164,
      email: input.email,
      serviceRequested: input.serviceRequested,
      estimatedValueKes: nichePreset.estimatedValueKes,
      executionMode,
      consentAccepted: input.consentAccepted,
      privacyNoticeVersion: input.privacyNoticeVersion,
      metadata: {
        ...input.metadata,
        niche: nicheKey,
        carrier: customerPhone.carrierType,
        demo_verification_reason: demoVerification.reason,
      },
      attribution: {
        ...input.attribution,
        ip_address: meta.ipAddress,
        user_agent: meta.userAgent,
      },
    });
    const dbLatencyMs = Date.now() - tDb0;
    const intakeLatencyMs = Date.now() - t0;

    // 6. Early return if deduplicated inside 10-minute sliding window
    if (ingestResult.is_duplicate) {
      const telemetry: TelemetryStep[] = [
        {
          step: 'normalize',
          label: 'E.164 Phone Normalization (libphonenumber-js)',
          durationMs: normLatencyMs,
          status: 'COMPLETED',
        },
        {
          step: 'rate_limit',
          label: 'Sliding-Window Anti-Abuse Guard (IP + E.164)',
          durationMs: null,
          status: 'COMPLETED',
        },
        {
          step: 'db_ingest',
          label: 'Atomic Advisory-Lock Dedup Check (10-min window)',
          durationMs: dbLatencyMs,
          status: 'COMPLETED',
        },
        {
          step: 'dispatch',
          label: 'Messaging Dispatch Suppressed (Duplicate Window)',
          durationMs: 0,
          status: 'SKIPPED',
        },
      ];

      return {
        httpStatus: 200,
        body: {
          success: true,
          leadId: ingestResult.lead_id,
          status: 'DEDUPLICATED',
          executionMode,
          dispatchMode: ingestResult.tenant_config.dispatch_mode,
          intakeLatencyMs,
          dbLatencyMs,
          telemetry,
          message:
            'Lead received. A project specialist is already reviewing your previous submission.',
        },
      };
    }

    const tenant = ingestResult.tenant_config;
    const leadId = ingestResult.lead_id;
    const isOptedOut = Boolean(ingestResult.is_opted_out);

    // 7. Offload parallel/waterfall dispatches into background task (waitUntil / QStash)
    const backgroundTask =
      executionMode === 'SANDBOX_SIMULATION'
        ? this.runSandboxSimulation({
            leadId,
            tenant,
            customerPhoneE164: customerPhone.e164,
            customerName: input.fullName,
            serviceRequested: input.serviceRequested,
            dbLatencyMs,
            intakeLatencyMs,
          })
        : this.runLiveDispatch({
            leadId,
            tenant,
            customerPhoneE164: customerPhone.e164,
            customerName: input.fullName,
            serviceRequested: input.serviceRequested,
            appBaseUrl: meta.appBaseUrl,
            dbLatencyMs,
            intakeLatencyMs,
            isOptedOut,
          });

    const isSandbox = executionMode === 'SANDBOX_SIMULATION';

    const telemetry: TelemetryStep[] = [
      {
        step: 'normalize',
        label: 'E.164 Phone Normalization (libphonenumber-js)',
        durationMs: normLatencyMs,
        status: 'COMPLETED',
      },
      {
        step: 'rate_limit',
        label: 'Sliding-Window Rate Limit Check (IP + E.164)',
        durationMs: null,
        status: 'COMPLETED',
      },
      {
        step: 'db_ingest',
        label: 'Supabase Atomic Ingest & Advisory Dedup (RPC)',
        durationMs: dbLatencyMs,
        status: 'COMPLETED',
      },
      {
        step: 'whatsapp',
        label: isSandbox
          ? 'Meta WhatsApp Cloud API (Sandbox Simulation - 0 Credits)'
          : 'Meta WhatsApp Cloud API Dispatch (waitUntil Async)',
        durationMs: null,
        status: isSandbox ? 'SIMULATED' : 'QUEUED_ASYNC',
      },
      {
        step: 'sms_and_alert',
        label: isSandbox
          ? "Africa's Talking SMS + 1-Tap Alert (Sandbox Simulation)"
          : tenant.dispatch_mode === 'WATERFALL_PROD'
            ? "Owner 1-Tap Alert + Waterfall SMS Fallback (waitUntil)"
            : "Africa's Talking Customer SMS + Owner 1-Tap Alert (waitUntil)",
        durationMs: null,
        status: isSandbox ? 'SIMULATED' : 'QUEUED_ASYNC',
      },
    ];

    return {
      httpStatus: 200,
      body: {
        success: true,
        leadId,
        status: isSandbox ? 'SIMULATED' : 'DISPATCHED',
        executionMode,
        dispatchMode: tenant.dispatch_mode,
        intakeLatencyMs,
        dbLatencyMs,
        telemetry,
        message: isSandbox
          ? 'Sandbox simulation complete. Use a signed demo URL (?sig=) to trigger live WhatsApp & SMS credits.'
          : 'Sub-second lead persisted and queued for asynchronous multi-channel dispatch.',
      },
      backgroundTask,
    };
  }

  /**
   * Executes background live dispatch according to tenant's DISPATCH_MODE.
   */
  private async runLiveDispatch(params: {
    leadId: string;
    tenant: TenantConfig;
    customerPhoneE164: string;
    customerName: string;
    serviceRequested: string;
    appBaseUrl: string;
    dbLatencyMs: number;
    intakeLatencyMs: number;
    isOptedOut: boolean;
  }): Promise<void> {
    const {
      leadId,
      tenant,
      customerPhoneE164,
      customerName,
      serviceRequested,
      appBaseUrl,
      dbLatencyMs,
      intakeLatencyMs,
      isOptedOut,
    } = params;

    const autoWa = !isOptedOut && (tenant.settings?.auto_dispatch_whatsapp ?? true);
    const autoSms = !isOptedOut && (tenant.settings?.auto_dispatch_sms ?? true);

    const ownerAlertPromise = this.sendAndRecordOwnerAlert({
      leadId,
      tenant,
      customerPhoneE164,
      customerName,
      serviceRequested,
      appBaseUrl,
    });

    const whatsappPromise = autoWa
      ? this.sendAndRecordWhatsApp({
          leadId,
          tenant,
          customerPhoneE164,
          customerName,
          serviceRequested,
        })
      : Promise.resolve<ProviderDispatchResult | null>(null);

    if (tenant.dispatch_mode === 'PARALLEL_DEMO') {
      const smsPromise = autoSms
        ? this.sendAndRecordCustomerSms({
            leadId,
            tenant,
            customerPhoneE164,
            customerName,
            serviceRequested,
          })
        : Promise.resolve<ProviderDispatchResult | null>(null);

      const [waRes, ownerRes] = await Promise.all([whatsappPromise, ownerAlertPromise, smsPromise]);

      const targetStatus = waRes?.success
        ? 'WHATSAPP_SENT'
        : ownerRes?.success
          ? 'DISPATCHED_TO_OWNER'
          : 'PENDING';

      await this.repository.updateLeadAfterDispatch(
        leadId,
        targetStatus,
        intakeLatencyMs,
        dbLatencyMs
      );
      return;
    }

    // WATERFALL_PROD: Send WhatsApp + Owner Alert immediately; defer Customer SMS
    const [waRes, ownerRes] = await Promise.all([whatsappPromise, ownerAlertPromise]);

    const targetStatus = waRes?.success
      ? 'WHATSAPP_SENT'
      : ownerRes?.success
        ? 'DISPATCHED_TO_OWNER'
        : 'PENDING';

    await this.repository.updateLeadAfterDispatch(
      leadId,
      targetStatus,
      intakeLatencyMs,
      dbLatencyMs
    );

    if (!autoSms) {
      return;
    }

    // If Meta failed immediately, fire SMS fallback right away
    if (!waRes || !waRes.success) {
      await this.sendAndRecordCustomerSms({
        leadId,
        tenant,
        customerPhoneE164,
        customerName,
        serviceRequested,
      });
      return;
    }

    // Schedule delayed waterfall check (QStash if configured, otherwise waitUntil timer)
    const delayMs = Number(
      tenant.settings?.waterfall_sms_delay_ms ??
        process.env.WATERFALL_SMS_DELAY_MS ??
        15000
    );

    const qstashScheduled = await this.tryScheduleQStashWaterfall({
      appBaseUrl,
      leadId,
      tenantSlug: tenant.slug,
      customerName,
      customerPhoneE164,
      serviceRequested,
      delaySeconds: Math.max(5, Math.ceil(delayMs / 1000)),
    });

    if (!qstashScheduled) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      await this.executeWaterfallSmsFallback({
        leadId,
        tenant,
        customerPhoneE164,
        customerName,
        serviceRequested,
      });
    }
  }

  /**
   * Executes Customer SMS fallback only if WhatsApp has not reached DELIVERED or CUSTOMER_REPLIED.
   */
  async executeWaterfallSmsFallback(params: {
    leadId: string;
    tenant: TenantConfig;
    customerPhoneE164: string;
    customerName: string;
    serviceRequested: string;
  }): Promise<{ skipped: boolean; reason?: string }> {
    const currentLead = await this.repository.getLeadStatus(params.leadId);
    if (currentLead && isLeadAlreadyDeliveredOrReplied(currentLead.status)) {
      return { skipped: true, reason: `Lead already at status ${currentLead.status}` };
    }

    await this.sendAndRecordCustomerSms(params);
    return { skipped: false };
  }

  private async runSandboxSimulation(params: {
    leadId: string;
    tenant: TenantConfig;
    customerPhoneE164: string;
    customerName: string;
    serviceRequested: string;
    dbLatencyMs: number;
    intakeLatencyMs: number;
  }): Promise<void> {
    await Promise.all([
      this.repository.recordDispatch({
        leadId: params.leadId,
        channel: 'WHATSAPP_CLOUD_API',
        destination: params.customerPhoneE164,
        status: 'SIMULATED',
        latencyMs: 0,
        requestPayload: {
          mode: 'SANDBOX_SIMULATION',
          customerName: params.customerName,
          serviceRequested: params.serviceRequested,
        },
        responsePayload: { simulated: true, creditsSaved: true },
      }),
      this.repository.recordDispatch({
        leadId: params.leadId,
        channel: 'OWNER_DIALER_ALERT',
        destination: params.tenant.owner_dialer_phone,
        status: 'SIMULATED',
        latencyMs: 0,
        requestPayload: { mode: 'SANDBOX_SIMULATION' },
        responsePayload: { simulated: true, creditsSaved: true },
      }),
      this.repository.updateLeadAfterDispatch(
        params.leadId,
        'DISPATCHED_TO_OWNER',
        params.intakeLatencyMs,
        params.dbLatencyMs
      ),
    ]);
  }

  private async sendAndRecordWhatsApp(params: {
    leadId: string;
    tenant: TenantConfig;
    customerPhoneE164: string;
    customerName: string;
    serviceRequested: string;
  }): Promise<ProviderDispatchResult> {
    const result = await this.whatsappProvider.send({
      leadId: params.leadId,
      toPhoneE164: params.customerPhoneE164,
      customerName: params.customerName,
      clientName: params.tenant.name,
      serviceRequested: params.serviceRequested,
      tenant: params.tenant,
    });

    await Promise.all([
      this.repository.recordDispatch({
        leadId: params.leadId,
        channel: 'WHATSAPP_CLOUD_API',
        destination: params.customerPhoneE164,
        providerMessageId: result.providerMessageId,
        status: result.success ? 'SUCCESS' : 'FAILED',
        latencyMs: result.latencyMs,
        requestPayload: result.requestPayload,
        responsePayload: result.responsePayload,
        errorMessage: result.errorMessage,
      }),
      result.success && result.providerMessageId
        ? this.repository.recordConversation({
            leadId: params.leadId,
            organizationId: params.tenant.id,
            channel: 'whatsapp',
            direction: 'outbound',
            externalMessageId: result.providerMessageId,
            messageBody: `Template: lead_instant_acknowledgement [${params.customerName}, ${params.tenant.name}, ${params.serviceRequested}]`,
            deliveryStatus: 'SENT',
            rawPayload: result.responsePayload,
          })
        : Promise.resolve(),
    ]);

    return result;
  }

  private async sendAndRecordCustomerSms(params: {
    leadId: string;
    tenant: TenantConfig;
    customerPhoneE164: string;
    customerName: string;
    serviceRequested: string;
  }): Promise<ProviderDispatchResult> {
    const messageBody = formatCompactCustomerSms({
      customerName: params.customerName,
      clientName: params.tenant.name,
      serviceRequested: params.serviceRequested,
    });

    const result = await this.smsProvider.send({
      leadId: params.leadId,
      toPhoneE164: params.customerPhoneE164,
      messageBody,
      channel: 'AFRICAS_TALKING_SMS',
      tenant: params.tenant,
    });

    await Promise.all([
      this.repository.recordDispatch({
        leadId: params.leadId,
        channel: 'AFRICAS_TALKING_SMS',
        destination: params.customerPhoneE164,
        providerMessageId: result.providerMessageId,
        status: result.success ? 'SUCCESS' : 'FAILED',
        latencyMs: result.latencyMs,
        requestPayload: result.requestPayload,
        responsePayload: result.responsePayload,
        errorMessage: result.errorMessage,
      }),
      result.success && result.providerMessageId
        ? this.repository.recordConversation({
            leadId: params.leadId,
            organizationId: params.tenant.id,
            channel: 'sms',
            direction: 'outbound',
            externalMessageId: result.providerMessageId,
            messageBody,
            deliveryStatus: 'SENT',
            rawPayload: result.responsePayload,
          })
        : Promise.resolve(),
    ]);

    return result;
  }

  private async sendAndRecordOwnerAlert(params: {
    leadId: string;
    tenant: TenantConfig;
    customerPhoneE164: string;
    customerName: string;
    serviceRequested: string;
    appBaseUrl: string;
  }): Promise<ProviderDispatchResult> {
    const ownerAlertMessage = formatCompactOwnerAlertSms({
      leadId: params.leadId,
      clientName: params.tenant.name,
      customerName: params.customerName,
      customerPhoneE164: params.customerPhoneE164,
      serviceRequested: params.serviceRequested,
      appBaseUrl: params.appBaseUrl,
    });

    const result = await this.smsProvider.send({
      leadId: params.leadId,
      toPhoneE164: params.tenant.owner_dialer_phone,
      messageBody: ownerAlertMessage,
      channel: 'OWNER_DIALER_ALERT',
      tenant: params.tenant,
    });

    await this.repository.recordDispatch({
      leadId: params.leadId,
      channel: 'OWNER_DIALER_ALERT',
      destination: params.tenant.owner_dialer_phone,
      providerMessageId: result.providerMessageId,
      status: result.success ? 'SUCCESS' : 'FAILED',
      latencyMs: result.latencyMs,
      requestPayload: result.requestPayload,
      responsePayload: result.responsePayload,
      errorMessage: result.errorMessage,
    });

    return result;
  }

  private async tryScheduleQStashWaterfall(params: {
    appBaseUrl: string;
    leadId: string;
    tenantSlug: string;
    customerName: string;
    customerPhoneE164: string;
    serviceRequested: string;
    delaySeconds: number;
  }): Promise<boolean> {
    const qstashToken = process.env.QSTASH_TOKEN?.trim();
    if (!qstashToken) return false;

    try {
      const targetUrl = `${params.appBaseUrl.replace(/\/$/, '')}/api/internal/waterfall-sms`;
      const res = await fetch(
        `https://qstash.upstash.io/v2/publish/${encodeURIComponent(targetUrl)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${qstashToken}`,
            'Content-Type': 'application/json',
            'Upstash-Delay': `${params.delaySeconds}s`,
            ...(process.env.INTERNAL_CALLBACK_SECRET
              ? { 'Upstash-Forward-x-internal-secret': process.env.INTERNAL_CALLBACK_SECRET }
              : {}),
          },
          body: JSON.stringify({
            leadId: params.leadId,
            tenantSlug: params.tenantSlug,
            customerName: params.customerName,
            customerPhoneE164: params.customerPhoneE164,
            serviceRequested: params.serviceRequested,
          }),
          signal: AbortSignal.timeout(2000),
        }
      );
      return res.ok;
    } catch (err) {
      console.warn('QStash scheduling failed, falling back to waitUntil delay:', err);
      return false;
    }
  }

  /**
   * Escalates unclicked leads past 5m SLA and expires unengaged leads past 1h SLA.
   */
  async runSlaEscalationSweep(params: {
    appBaseUrl: string;
    escalateAfterSeconds?: number;
    expireAfterSeconds?: number;
    limit?: number;
  }): Promise<{ expiredCount: number; escalatedCount: number }> {
    const claim = await this.repository.claimOverdueSlaLeads({
      escalateAfterSeconds: params.escalateAfterSeconds ?? 300,
      expireAfterSeconds: params.expireAfterSeconds ?? 3600,
      limit: params.limit ?? 25,
    });

    if (claim.escalations.length === 0) {
      return { expiredCount: claim.expired_count, escalatedCount: 0 };
    }

    await Promise.allSettled(
      claim.escalations.map(async (item) => {
        const messageBody = formatSlaEscalationSms({
          leadId: item.lead_id,
          clientName: item.tenant.name,
          customerName: item.customer_name,
          customerPhoneE164: item.customer_phone_e164,
          appBaseUrl: params.appBaseUrl,
        });

        const result = await this.smsProvider.send({
          leadId: item.lead_id,
          toPhoneE164: item.tenant.owner_dialer_phone,
          messageBody,
          channel: 'OWNER_DIALER_ALERT',
          tenant: item.tenant,
        });

        await this.repository.recordDispatch({
          leadId: item.lead_id,
          channel: 'OWNER_DIALER_ALERT',
          destination: item.tenant.owner_dialer_phone,
          providerMessageId: result.providerMessageId,
          status: result.success ? 'SUCCESS' : 'FAILED',
          latencyMs: result.latencyMs,
          requestPayload: { ...result.requestPayload, escalation: true },
          responsePayload: result.responsePayload,
          errorMessage: result.errorMessage,
        });
      })
    );

    return {
      expiredCount: claim.expired_count,
      escalatedCount: claim.escalations.length,
    };
  }
}
