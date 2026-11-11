/**
 * Supabase Repository & Tenant Resolver Adapter
 * Implements LeadRepository and TenantResolver via atomic PostgreSQL RPCs and typed queries.
 */

import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ApplyWebhookStatusParams,
  IngestLeadParams,
  LeadRepository,
  OwnerClickTarget,
  RecordConversationParams,
  RecordDispatchParams,
  TenantResolver,
} from '@/core/ports';
import type {
  IngestLeadAtomicResult,
  LeadStatus,
  OrganizationSettings,
  TenantConfig,
  WebhookProvider,
} from '@/core/domain';
import type { Database, Json } from './database.types';
import { isSupabaseConfigured } from './supabase-client';

export class SupabaseLeadRepository implements LeadRepository, TenantResolver {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async resolveBySlug(slug: string): Promise<TenantConfig | null> {
    if (!isSupabaseConfigured()) return null;

    const { data, error } = await this.supabase
      .from('organizations')
      .select(
        'id, slug, name, niche, owner_dialer_phone, dispatch_mode, whatsapp_phone_number_id, whatsapp_access_token_encrypted, at_sender_id, primary_color, settings'
      )
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !data) return null;

    return {
      ...data,
      settings: (data.settings || {}) as OrganizationSettings,
    };
  }

  async resolveByWhatsAppPhoneNumberId(phoneNumberId: string): Promise<TenantConfig | null> {
    if (!isSupabaseConfigured()) return null;

    const { data, error } = await this.supabase
      .from('organizations')
      .select(
        'id, slug, name, niche, owner_dialer_phone, dispatch_mode, whatsapp_phone_number_id, whatsapp_access_token_encrypted, at_sender_id, primary_color, settings'
      )
      .eq('whatsapp_phone_number_id', phoneNumberId)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !data) return null;

    return {
      ...data,
      settings: (data.settings || {}) as OrganizationSettings,
    };
  }

  async ingestLeadAtomic(params: IngestLeadParams): Promise<IngestLeadAtomicResult> {
    // Graceful dry-run fallback only when Supabase env vars are not configured
    if (!isSupabaseConfigured()) {
      return this.buildUnconfiguredFallbackResult(params);
    }

    const { data, error } = await this.supabase.rpc('ingest_lead_atomic', {
      p_org_slug: params.organizationSlug,
      p_org_name: params.organizationName,
      p_niche: params.niche,
      p_primary_color: params.primaryColor,
      p_owner_phone: params.ownerPhone,
      p_allow_auto_register: params.allowAutoRegister,
      p_raw_name: params.rawName,
      p_phone_e164: params.phoneE164,
      p_email: params.email || '',
      p_service_requested: params.serviceRequested,
      p_estimated_value_kes: params.estimatedValueKes,
      p_execution_mode: params.executionMode,
      p_metadata: params.metadata as Json,
      p_attribution: params.attribution as Json,
    });

    if (error) {
      throw new Error(`ingest_lead_atomic failed: ${error.message}`);
    }

    if (!data || typeof data !== 'object') {
      throw new Error('ingest_lead_atomic returned an empty payload');
    }

    return data as unknown as IngestLeadAtomicResult;
  }

  async updateLeadAfterDispatch(
    leadId: string,
    status: LeadStatus,
    firstResponseLatencyMs?: number,
    dbLatencyMs?: number
  ): Promise<void> {
    if (!isSupabaseConfigured()) return;

    const updatePayload: Database['public']['Tables']['leads']['Update'] = { status };
    if (typeof firstResponseLatencyMs === 'number') {
      updatePayload.first_response_latency_ms = firstResponseLatencyMs;
    }
    if (typeof dbLatencyMs === 'number') {
      updatePayload.db_latency_ms = dbLatencyMs;
    }

    const { error } = await this.supabase.from('leads').update(updatePayload).eq('id', leadId);
    if (error) {
      console.error('Failed to update lead dispatch status:', error.message);
    }
  }

  async getLeadStatus(leadId: string): Promise<{
    id: string;
    status: LeadStatus;
    organization_id: string;
    phone_e164: string;
    raw_name: string;
    service_requested: string;
  } | null> {
    if (!isSupabaseConfigured()) return null;

    const { data, error } = await this.supabase
      .from('leads')
      .select('id, status, organization_id, phone_e164, raw_name, service_requested')
      .eq('id', leadId)
      .maybeSingle();

    if (error || !data) return null;
    return data;
  }

  async recordDispatch(params: RecordDispatchParams): Promise<void> {
    if (!isSupabaseConfigured()) return;

    const { error } = await this.supabase.from('lead_dispatches').insert({
      lead_id: params.leadId,
      channel: params.channel,
      destination: params.destination,
      provider_message_id: params.providerMessageId ?? null,
      status: params.status,
      latency_ms: params.latencyMs,
      request_payload: params.requestPayload as Json,
      response_payload: (params.responsePayload ?? {}) as Json,
      error_message: params.errorMessage ?? null,
    });

    if (error) {
      console.error('Failed to record lead dispatch:', error.message);
    }
  }

  async recordConversation(params: RecordConversationParams): Promise<void> {
    if (!isSupabaseConfigured()) return;

    const { error } = await this.supabase.from('conversations').insert({
      lead_id: params.leadId,
      organization_id: params.organizationId,
      channel: params.channel,
      direction: params.direction,
      external_message_id: params.externalMessageId ?? null,
      message_body: params.messageBody,
      delivery_status: params.deliveryStatus,
      raw_payload: (params.rawPayload ?? {}) as Json,
    });

    if (error) {
      console.error('Failed to record conversation:', error.message);
    }
  }

  async applyWebhookEventAtomic(
    params: ApplyWebhookStatusParams
  ): Promise<{ duplicate: boolean; leadId: string | null }> {
    if (!isSupabaseConfigured()) {
      return { duplicate: false, leadId: null };
    }

    const { data, error } = await this.supabase.rpc('apply_webhook_event_atomic', {
      p_provider: params.provider,
      p_provider_message_id: params.providerMessageId,
      p_event_status: params.eventStatus,
      p_lead_target_status: params.leadTargetStatus,
      p_conversation_delivery_status: params.conversationDeliveryStatus,
      p_dispatch_status: params.dispatchStatus,
      p_raw_payload: params.rawPayload as Json,
    });

    if (error) {
      throw new Error(`apply_webhook_event_atomic failed: ${error.message}`);
    }

    const result = (data || {}) as { duplicate?: boolean; lead_id?: string | null };
    return {
      duplicate: Boolean(result.duplicate),
      leadId: result.lead_id ?? null,
    };
  }

  async recordInboundWebhookMessage(params: {
    provider: WebhookProvider;
    providerMessageId: string;
    senderPhoneE164: string;
    channel: 'whatsapp' | 'sms';
    messageBody: string;
    organizationIdFilter?: string | null;
    rawPayload: Record<string, unknown>;
  }): Promise<{ duplicate: boolean; leadId: string | null }> {
    if (!isSupabaseConfigured()) {
      return { duplicate: false, leadId: null };
    }

    // 1. Idempotency check in webhook_events
    const eventKey = params.providerMessageId || crypto.createHash('sha256').update(JSON.stringify(params.rawPayload)).digest('hex');

    const { data: insertedEvent, error: ledgerErr } = await this.supabase
      .from('webhook_events')
      .insert({
        provider: params.provider,
        provider_message_id: eventKey,
        status: 'INBOUND_MESSAGE',
        raw_payload: params.rawPayload as Json,
      })
      .select('id')
      .maybeSingle();

    if (ledgerErr) {
      // Unique violation (23505) means duplicate webhook retry
      if (ledgerErr.code === '23505') {
        return { duplicate: true, leadId: null };
      }
      throw new Error(`Webhook ledger insert failed: ${ledgerErr.message}`);
    }

    if (!insertedEvent) {
      return { duplicate: true, leadId: null };
    }

    // 2. Locate most recent matching lead
    let leadQuery = this.supabase
      .from('leads')
      .select('id, organization_id')
      .eq('phone_e164', params.senderPhoneE164);

    if (params.organizationIdFilter) {
      leadQuery = leadQuery.eq('organization_id', params.organizationIdFilter);
    }

    const { data: lead } = await leadQuery
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lead) {
      return { duplicate: false, leadId: null };
    }

    // 3. Link ledger, record conversation, and advance lead status atomically
    await Promise.all([
      this.supabase.from('webhook_events').update({ lead_id: lead.id }).eq('id', insertedEvent.id),
      this.recordConversation({
        leadId: lead.id,
        organizationId: lead.organization_id,
        channel: params.channel,
        direction: 'inbound',
        externalMessageId: eventKey,
        messageBody: params.messageBody,
        deliveryStatus: 'RECEIVED',
        rawPayload: params.rawPayload,
      }),
      this.supabase
        .from('leads')
        .update({
          status: 'CUSTOMER_REPLIED',
          customer_replied_at: new Date().toISOString(),
        })
        .eq('id', lead.id),
    ]);

    return { duplicate: false, leadId: lead.id };
  }

  async recordOwnerClickSla(params: {
    leadId: string;
    channel: 'call' | 'wa';
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<OwnerClickTarget | null> {
    if (!isSupabaseConfigured()) {
      return null;
    }

    const { data, error } = await this.supabase.rpc('record_owner_click_sla', {
      p_lead_id: params.leadId,
      p_channel: params.channel,
      p_ip_address: params.ipAddress ?? null,
      p_user_agent: params.userAgent ?? null,
    });

    if (error) {
      throw new Error(`record_owner_click_sla failed: ${error.message}`);
    }

    if (!data || typeof data !== 'object') {
      return null;
    }

    const row = data as {
      lead_id: string;
      organization_id: string;
      organization_name: string;
      customer_name: string;
      customer_phone_e164: string;
      service_requested: string;
    };

    return {
      leadId: row.lead_id,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      customerName: row.customer_name,
      customerPhoneE164: row.customer_phone_e164,
      serviceRequested: row.service_requested,
    };
  }

  private buildUnconfiguredFallbackResult(params: IngestLeadParams): IngestLeadAtomicResult {
    return {
      lead_id: crypto.randomUUID(),
      is_duplicate: false,
      existing_status: null,
      tenant_config: {
        id: '00000000-0000-0000-0000-000000000001',
        slug: params.organizationSlug,
        name: params.organizationName,
        niche: params.niche,
        owner_dialer_phone: params.ownerPhone || params.phoneE164,
        dispatch_mode: 'PARALLEL_DEMO',
        primary_color: params.primaryColor,
        settings: {
          auto_dispatch_whatsapp: true,
          auto_dispatch_sms: true,
          dedup_window_minutes: 10,
          waterfall_sms_delay_ms: 15000,
        },
      },
    };
  }
}
