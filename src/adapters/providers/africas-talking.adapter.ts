/**
 * Africa's Talking SMS Adapter
 * Isolated AT client with sandbox/production routing, DLR messageId correlation,
 * per-tenant `at_sender_id` resolution with automatic fallback to system default sender,
 * bounded timeouts, and exponential backoff retries.
 */

import type {
  MessagingProvider,
  ProviderDispatchResult,
  SmsDispatchRequest,
} from '@/core/ports';

interface AfricasTalkingRecipient {
  statusCode?: number;
  number?: string;
  status?: string;
  cost?: string;
  messageId?: string;
}

interface AfricasTalkingSmsResponse {
  SMSMessageData?: {
    Message?: string;
    Recipients?: AfricasTalkingRecipient[];
  };
}

export interface AfricasTalkingAdapterConfig {
  timeoutMs?: number;
  maxRetries?: number;
}

export class AfricasTalkingAdapter implements MessagingProvider<SmsDispatchRequest> {
  readonly channel = 'AFRICAS_TALKING_SMS' as const;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(config: AfricasTalkingAdapterConfig = {}) {
    this.timeoutMs = config.timeoutMs ?? 4500;
    this.maxRetries = config.maxRetries ?? 2;
  }

  async send(request: SmsDispatchRequest): Promise<ProviderDispatchResult> {
    const startMs = Date.now();
    const apiKey = process.env.AFRICASTALKING_API_KEY?.trim();
    const username = process.env.AFRICASTALKING_USERNAME?.trim() || 'sandbox';

    const preferredSenderId = request.tenant.at_sender_id?.trim() || undefined;
    const baseRequestPayload: Record<string, unknown> = {
      to: request.toPhoneE164,
      message: request.messageBody,
      senderId: preferredSenderId ?? null,
    };

    if (!apiKey) {
      return {
        success: false,
        channel: request.channel,
        providerMessageId: null,
        latencyMs: Date.now() - startMs,
        requestPayload: baseRequestPayload,
        errorMessage: "Africa's Talking API key is not configured",
      };
    }

    const endpoint =
      username.toLowerCase() === 'sandbox'
        ? 'https://api.sandbox.africastalking.com/version1/messaging'
        : 'https://api.africastalking.com/version1/messaging';

    // First attempt uses tenant at_sender_id if configured
    const primaryAttempt = await this.executeWithRetries(
      endpoint,
      apiKey,
      username,
      request.toPhoneE164,
      request.messageBody,
      preferredSenderId
    );

    if (primaryAttempt.ok) {
      return {
        success: true,
        channel: request.channel,
        providerMessageId: primaryAttempt.messageId,
        latencyMs: Date.now() - startMs,
        requestPayload: baseRequestPayload,
        responsePayload: primaryAttempt.responsePayload,
      };
    }

    // Automatic sender ID fallback: if custom at_sender_id failed, retry once using system default sender
    if (preferredSenderId && this.shouldFallbackSenderId(primaryAttempt.errorMessage)) {
      const fallbackAttempt = await this.executeWithRetries(
        endpoint,
        apiKey,
        username,
        request.toPhoneE164,
        request.messageBody,
        undefined
      );

      return {
        success: fallbackAttempt.ok,
        channel: request.channel,
        providerMessageId: fallbackAttempt.messageId,
        latencyMs: Date.now() - startMs,
        requestPayload: { ...baseRequestPayload, senderFallbackApplied: true },
        responsePayload: fallbackAttempt.responsePayload,
        errorMessage: fallbackAttempt.ok ? null : fallbackAttempt.errorMessage,
      };
    }

    return {
      success: false,
      channel: request.channel,
      providerMessageId: null,
      latencyMs: Date.now() - startMs,
      requestPayload: baseRequestPayload,
      responsePayload: primaryAttempt.responsePayload,
      errorMessage: primaryAttempt.errorMessage,
    };
  }

  private async executeWithRetries(
    endpoint: string,
    apiKey: string,
    username: string,
    to: string,
    message: string,
    senderId?: string
  ): Promise<{
    ok: boolean;
    messageId: string | null;
    responsePayload?: Record<string, unknown>;
    errorMessage: string | null;
  }> {
    let lastError = "Africa's Talking SMS dispatch failed";
    let lastPayload: Record<string, unknown> | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const params: Record<string, string> = {
          username,
          to,
          message,
        };
        if (senderId) {
          params.from = senderId;
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            apiKey,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams(params).toString(),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        const rawText = await res.text();
        let data: AfricasTalkingSmsResponse = {};
        try {
          data = JSON.parse(rawText) as AfricasTalkingSmsResponse;
        } catch {
          lastPayload = { rawText };
        }

        if (!lastPayload) {
          lastPayload = data as unknown as Record<string, unknown>;
        }

        const recipient = data.SMSMessageData?.Recipients?.[0];
        const recipientStatusCode = recipient?.statusCode;
        const recipientSucceeded =
          res.ok &&
          recipient &&
          (recipientStatusCode === 100 ||
            recipientStatusCode === 101 ||
            recipientStatusCode === 102 ||
            recipient.status?.toLowerCase() === 'success');

        if (recipientSucceeded) {
          return {
            ok: true,
            messageId: recipient.messageId ?? null,
            responsePayload: lastPayload,
            errorMessage: null,
          };
        }

        lastError =
          recipient?.status ||
          data.SMSMessageData?.Message ||
          rawText ||
          `AT HTTP ${res.status}`;

        if (!(res.status === 429 || res.status >= 500) || attempt === this.maxRetries) {
          break;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Africa's Talking network error";
        if (attempt === this.maxRetries) {
          break;
        }
      }

      const baseMs = 150 * Math.pow(2, attempt);
      const jitterMs = Math.floor(Math.random() * 100);
      await new Promise((resolve) => setTimeout(resolve, baseMs + jitterMs));
    }

    return {
      ok: false,
      messageId: null,
      responsePayload: lastPayload,
      errorMessage: lastError,
    };
  }

  private shouldFallbackSenderId(errorMessage: string | null): boolean {
    if (!errorMessage) return false;
    return /sender|invalid\s*from|alphanumeric|shortcode/i.test(errorMessage);
  }
}
