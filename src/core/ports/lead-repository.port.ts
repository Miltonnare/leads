/**
 * Lead Repository Port
 * Abstract persistence & state-transition interface for leads, dispatches, conversations, and webhooks.
 */

import type {
  DispatchChannel,
  DispatchStatus,
  ExecutionMode,
  IngestLeadAtomicResult,
  LeadAttribution,
  LeadStatus,
  OverdueSlaClaimResult,
  WebhookProvider,
} from '../domain';

export interface IngestLeadParams {
  organizationSlug: string;
  organizationName: string;
  niche: string;
  primaryColor: string;
  ownerPhone: string;
  allowAutoRegister: boolean;
  rawName: string;
  phoneE164: string;
  email?: string;
  serviceRequested: string;
  estimatedValueKes: number;
  executionMode: ExecutionMode;
  consentAccepted: boolean;
  privacyNoticeVersion: string;
  metadata: Record<string, unknown>;
  attribution: LeadAttribution;
}

export interface RecordDispatchParams {
  leadId: string;
  channel: DispatchChannel;
  destination: string;
  providerMessageId?: string | null;
  status: DispatchStatus;
  latencyMs: number;
  requestPayload: Record<string, unknown>;
  responsePayload?: Record<string, unknown>;
  errorMessage?: string | null;
}

export interface RecordConversationParams {
  leadId: string;
  organizationId: string;
  channel: 'whatsapp' | 'sms';
  direction: 'inbound' | 'outbound';
  externalMessageId?: string | null;
  messageBody: string;
  deliveryStatus: string;
  rawPayload?: Record<string, unknown>;
}

export interface ApplyWebhookStatusParams {
  provider: WebhookProvider;
  providerMessageId: string;
  eventStatus: string;
  leadTargetStatus: LeadStatus | null;
  conversationDeliveryStatus: string | null;
  dispatchStatus: DispatchStatus | null;
  rawPayload: Record<string, unknown>;
}

export interface OwnerClickTarget {
  leadId: string;
  organizationId: string;
  organizationName: string;
  customerName: string;
  customerPhoneE164: string;
  serviceRequested: string;
}

export interface LeadRepository {
  ingestLeadAtomic(params: IngestLeadParams): Promise<IngestLeadAtomicResult>;

  updateLeadAfterDispatch(
    leadId: string,
    status: LeadStatus,
    firstResponseLatencyMs?: number,
    dbLatencyMs?: number
  ): Promise<void>;

  claimCustomerFallback(leadId: string, organizationId: string, phone: string): Promise<boolean>;

  getLeadStatus(leadId: string): Promise<{
    id: string;
    status: LeadStatus;
    organization_id: string;
    phone_e164: string;
    raw_name: string;
    service_requested: string;
  } | null>;

  recordDispatch(params: RecordDispatchParams): Promise<void>;

  recordConversation(params: RecordConversationParams): Promise<void>;

  applyWebhookEventAtomic(
    params: ApplyWebhookStatusParams
  ): Promise<{ duplicate: boolean; leadId: string | null }>;

  recordInboundWebhookMessage(params: {
    provider: WebhookProvider;
    providerMessageId: string;
    senderPhoneE164: string;
    channel: 'whatsapp' | 'sms';
    messageBody: string;
    organizationIdFilter?: string | null;
    rawPayload: Record<string, unknown>;
  }): Promise<{ duplicate: boolean; leadId: string | null }>;

  recordOwnerClickSla(params: {
    leadId: string;
    channel: 'call' | 'wa';
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<OwnerClickTarget | null>;

  recordPhoneOptOut(params: {
    phoneE164: string;
    organizationId?: string | null;
    source: string;
    reason: string;
  }): Promise<void>;

  claimOverdueSlaLeads(params: {
    escalateAfterSeconds: number;
    expireAfterSeconds: number;
    limit: number;
  }): Promise<OverdueSlaClaimResult>;
}
