/**
 * Chameleon Lead Recovery Engine - Core Domain Types
 * Pure TypeScript domain entities, enums, and value objects (zero external SDK imports).
 */

export type LeadStatus =
  | 'PENDING'
  | 'NEW'
  | 'DEDUPLICATED'
  | 'DISPATCHED_TO_OWNER'
  | 'SENT'
  | 'WHATSAPP_SENT'
  | 'DELIVERED'
  | 'CUSTOMER_REPLIED'
  | 'ENGAGED'
  | 'CONVERTED'
  | 'LOST'
  | 'EXPIRED_NO_RESPONSE';

export type DispatchMode = 'PARALLEL_DEMO' | 'WATERFALL_PROD';

export type ExecutionMode = 'LIVE_DISPATCH' | 'SANDBOX_SIMULATION';

export type DispatchChannel =
  | 'WHATSAPP_CLOUD_API'
  | 'AFRICAS_TALKING_SMS'
  | 'OWNER_DIALER_ALERT'
  | 'SYSTEM_WEBHOOK';

export type DispatchStatus =
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'FALLBACK_TRIGGERED'
  | 'SIMULATED';

export type WebhookProvider = 'META_WHATSAPP' | 'AFRICAS_TALKING';

export type NicheKey = 'borehole' | 'solar' | 'vehicle' | 'dental' | 'plant' | 'general';

export type CarrierType = 'safaricom' | 'airtel' | 'telkom' | 'other';

export interface ValidatedPhone {
  isValid: boolean;
  e164: string;
  countryCode: string;
  formattedInternational: string;
  formattedNational: string;
  carrierType?: CarrierType;
}

export interface OrganizationSettings {
  auto_dispatch_whatsapp?: boolean;
  auto_dispatch_sms?: boolean;
  dedup_window_minutes?: number;
  waterfall_sms_delay_ms?: number;
  working_hours_only?: boolean;
}

export interface TenantConfig {
  id: string;
  slug: string;
  name: string;
  niche: NicheKey | string;
  owner_dialer_phone: string;
  dispatch_mode: DispatchMode;
  whatsapp_phone_number_id?: string | null;
  whatsapp_access_token_encrypted?: string | null;
  at_sender_id?: string | null;
  primary_color: string;
  settings: OrganizationSettings;
}

export interface LeadAttribution {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  referrer?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
}

export interface Lead {
  id: string;
  organization_id: string;
  raw_name: string;
  phone_e164: string;
  email?: string | null;
  service_requested: string;
  estimated_value_kes: number;
  status: LeadStatus;
  execution_mode: ExecutionMode;
  first_response_latency_ms?: number | null;
  db_latency_ms?: number | null;
  owner_call_initiated_at?: string | null;
  owner_clicked_call_at?: string | null;
  owner_clicked_wa_at?: string | null;
  customer_replied_at?: string | null;
  metadata: Record<string, unknown>;
  attribution: LeadAttribution;
  created_at: string;
  updated_at: string;
}

export interface NichePreset {
  key: NicheKey;
  headline: string;
  subhead: string;
  services: string[];
  defaultService: string;
  cta: string;
  estimatedValueKes: number;
}

export interface SignedDemoParams {
  client: string;
  color: string;
  phone: string;
  niche: NicheKey;
  exp: number;
  sig?: string;
}

export interface DemoContextVerification {
  isSignedLive: boolean;
  executionMode: ExecutionMode;
  reason: 'VALID_SIGNATURE' | 'UNSIGNED_DEMO' | 'EXPIRED_SIGNATURE' | 'INVALID_SIGNATURE';
  sanitizedParams: {
    client: string;
    color: string;
    phone: string;
    niche: NicheKey;
    exp?: number;
    sig?: string;
  };
}

export interface IngestLeadAtomicResult {
  lead_id: string;
  is_duplicate: boolean;
  is_opted_out?: boolean;
  existing_status: LeadStatus | null;
  tenant_config: TenantConfig;
}

export interface SlaEscalationCandidate {
  lead_id: string;
  customer_name: string;
  customer_phone_e164: string;
  service_requested: string;
  created_at: string;
  tenant: TenantConfig;
}

export interface OverdueSlaClaimResult {
  expired_count: number;
  escalations: SlaEscalationCandidate[];
}

export interface TelemetryStep {
  step: string;
  label: string;
  durationMs: number | null;
  status: 'COMPLETED' | 'QUEUED_ASYNC' | 'SIMULATED' | 'SKIPPED';
}

export interface LeadSubmissionResponse {
  success: boolean;
  leadId?: string;
  status: 'DISPATCHED' | 'DEDUPLICATED' | 'SIMULATED' | 'FAILED';
  executionMode?: ExecutionMode;
  dispatchMode?: DispatchMode;
  intakeLatencyMs?: number;
  dbLatencyMs?: number;
  telemetry?: TelemetryStep[];
  message: string;
  error?: string;
  details?: unknown;
}
