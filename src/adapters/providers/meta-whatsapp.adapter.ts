/**
 * Meta WhatsApp Cloud API Adapter
 * Isolated Graph API v27.0 client with per-tenant credential resolution, master fallback,
 * template payload builder, strict typing, bounded timeouts, and exponential backoff retries.
 */

import type {
  MessagingProvider,
  ProviderDispatchResult,
  WhatsAppTemplateRequest,
} from '@/core/ports';
import { decryptTenantSecret } from '@/adapters/security/token-crypto';

interface MetaMessagesApiResponse {
  messaging_product?: string;
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string; message_status?: string }>;
  error?: {
    message: string;
    type: string;
    code: number;
    fbtrace_id?: string;
  };
}

export interface MetaWhatsAppAdapterConfig {
  graphApiVersion?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export class MetaWhatsAppAdapter implements MessagingProvider<WhatsAppTemplateRequest> {
  readonly channel = 'WHATSAPP_CLOUD_API' as const;
  private readonly graphApiVersion: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(config: MetaWhatsAppAdapterConfig = {}) {
    this.graphApiVersion =
      config.graphApiVersion ||
      process.env.WHATSAPP_GRAPH_API_VERSION?.trim() ||
      'v27.0';
    this.timeoutMs = config.timeoutMs ?? 4500;
    this.maxRetries = config.maxRetries ?? 2;
  }

  async send(request: WhatsAppTemplateRequest): Promise<ProviderDispatchResult> {
    const startMs = Date.now();

    const credentials = this.resolveCredentials(request);
    const payload = this.buildTemplatePayload(request);

    if (!credentials) {
      return {
        success: false,
        channel: this.channel,
        providerMessageId: null,
        latencyMs: Date.now() - startMs,
        requestPayload: payload,
        errorMessage: 'Meta WhatsApp Cloud API credentials are not configured',
      };
    }

    const endpoint = `https://graph.facebook.com/${this.graphApiVersion}/${credentials.phoneNumberId}/messages`;

    let lastError = 'Unknown Meta API failure';
    let lastResponsePayload: Record<string, unknown> | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${credentials.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        const data = (await res.json().catch(() => ({}))) as MetaMessagesApiResponse;
        lastResponsePayload = data as unknown as Record<string, unknown>;

        if (res.ok) {
          const wamid = data.messages?.[0]?.id ?? null;
          return {
            success: true,
            channel: this.channel,
            providerMessageId: wamid,
            latencyMs: Date.now() - startMs,
            requestPayload: payload,
            responsePayload: lastResponsePayload,
          };
        }

        lastError = data.error
          ? `Meta API ${data.error.code}: ${data.error.message}`
          : `Meta HTTP ${res.status}`;

        if (!this.isRetryableStatus(res.status) || attempt === this.maxRetries) {
          break;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Meta network exception';
        if (attempt === this.maxRetries) {
          break;
        }
      }

      await this.sleepWithJitter(attempt);
    }

    return {
      success: false,
      channel: this.channel,
      providerMessageId: null,
      latencyMs: Date.now() - startMs,
      requestPayload: payload,
      responsePayload: lastResponsePayload,
      errorMessage: lastError,
    };
  }

  private resolveCredentials(
    request: WhatsAppTemplateRequest
  ): { phoneNumberId: string; accessToken: string } | null {
    const tenantPhoneId = request.tenant.whatsapp_phone_number_id?.trim() || null;
    const tenantToken = decryptTenantSecret(request.tenant.whatsapp_access_token_encrypted);

    if (tenantPhoneId || request.tenant.whatsapp_access_token_encrypted) {
      return tenantPhoneId && tenantToken ? { phoneNumberId: tenantPhoneId, accessToken: tenantToken } : null;
    }

    const phoneNumberId = tenantPhoneId || process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || null;
    const accessToken = tenantToken || process.env.WHATSAPP_CLOUD_API_TOKEN?.trim() || null;

    if (!phoneNumberId || !accessToken) {
      return null;
    }

    return { phoneNumberId, accessToken };
  }

  private buildTemplatePayload(request: WhatsAppTemplateRequest): Record<string, unknown> {
    const metaRecipient = request.toPhoneE164.replace(/^\+/, '');
    const templateName = request.templateName || 'lead_instant_acknowledgement';

    return {
      messaging_product: 'whatsapp',
      to: metaRecipient,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: request.customerName },
              { type: 'text', text: request.clientName },
              { type: 'text', text: request.serviceRequested },
            ],
          },
        ],
      },
    };
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
  }

  private async sleepWithJitter(attempt: number): Promise<void> {
    const baseMs = 150 * Math.pow(2, attempt);
    const jitterMs = Math.floor(Math.random() * 100);
    await new Promise((resolve) => setTimeout(resolve, baseMs + jitterMs));
  }
}
