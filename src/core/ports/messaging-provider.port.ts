/**
 * Messaging Provider Port
 * Defines abstract contracts for WhatsApp Cloud API and SMS telecom adapters.
 */

import type { DispatchChannel, TenantConfig } from '../domain';

export interface ProviderDispatchResult {
  success: boolean;
  channel: DispatchChannel;
  providerMessageId?: string | null;
  latencyMs: number;
  requestPayload: Record<string, unknown>;
  responsePayload?: Record<string, unknown>;
  errorMessage?: string | null;
}

export interface WhatsAppTemplateRequest {
  leadId: string;
  toPhoneE164: string;
  customerName: string;
  clientName: string;
  serviceRequested: string;
  templateName?: string;
  tenant: TenantConfig;
}

export interface SmsDispatchRequest {
  leadId: string;
  toPhoneE164: string;
  messageBody: string;
  channel: 'AFRICAS_TALKING_SMS' | 'OWNER_DIALER_ALERT';
  tenant: TenantConfig;
}

export interface MessagingProvider<TRequest> {
  readonly channel: DispatchChannel;
  send(request: TRequest): Promise<ProviderDispatchResult>;
}
