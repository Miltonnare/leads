/**
 * Idempotent Webhook Processor Service
 * Processes Meta WhatsApp Cloud API and Africa's Talking webhooks using the
 * `(provider, provider_message_id, status)` ledger and monotonic state machine.
 */

import crypto from 'crypto';
import { validateAndFormatPhone, type DispatchStatus, type LeadStatus } from '@/core/domain';
import type { LeadRepository, TenantResolver } from '@/core/ports';

interface MetaWebhookBody {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: Array<{
          id?: string;
          from?: string;
          text?: { body?: string };
          type?: string;
          button?: { text?: string };
          interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
        }>;
        statuses?: Array<{
          id?: string;
          status?: string;
          timestamp?: string;
          errors?: unknown[];
        }>;
      };
    }>;
  }>;
}

export interface AfricasTalkingWebhookInput {
  from?: string;
  phoneNumber?: string;
  sender?: string;
  text?: string;
  message?: string;
  id?: string;
  messageId?: string;
  status?: string;
  networkCode?: string;
  failureReason?: string;
}

export class WebhookProcessorService {
  constructor(
    private readonly repository: LeadRepository,
    private readonly tenantResolver: TenantResolver
  ) {}

  verifyMetaSignature(rawBody: string, signatureHeader: string | null): boolean {
    const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
    if (!appSecret) {
      return true;
    }
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
      return false;
    }

    const clientSig = signatureHeader.slice(7);
    const expectedSig = crypto
      .createHmac('sha256', appSecret)
      .update(rawBody, 'utf8')
      .digest('hex');

    const clientBuf = Buffer.from(clientSig, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');

    if (clientBuf.length !== expectedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(clientBuf, expectedBuf);
  }

  async processWhatsAppWebhook(
    body: MetaWebhookBody
  ): Promise<{ processedEvents: number; duplicateEvents: number; ignored: boolean }> {
    if (body.object !== 'whatsapp_business_account') {
      return { processedEvents: 0, duplicateEvents: 0, ignored: true };
    }

    let processedEvents = 0;
    let duplicateEvents = 0;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        if (!value) continue;

        const phoneNumberId = value.metadata?.phone_number_id;
        let orgIdFilter: string | null = null;
        if (phoneNumberId) {
          const tenant = await this.tenantResolver.resolveByWhatsAppPhoneNumberId(phoneNumberId);
          orgIdFilter = tenant?.id ?? null;
        }

        // 1. Process Inbound Customer Messages
        for (const msg of value.messages || []) {
          if (!msg.from || !msg.id) continue;

          const phoneResult = validateAndFormatPhone(`+${msg.from.replace(/^\+/, '')}`);
          const senderE164 = phoneResult.isValid
            ? phoneResult.e164
            : `+${msg.from.replace(/^\+/, '')}`;

          const messageBody =
            msg.text?.body ||
            msg.button?.text ||
            msg.interactive?.button_reply?.title ||
            msg.interactive?.list_reply?.title ||
            '[Interactive Button / Media Selection]';

          const outcome = await this.repository.recordInboundWebhookMessage({
            provider: 'META_WHATSAPP',
            providerMessageId: msg.id,
            senderPhoneE164: senderE164,
            channel: 'whatsapp',
            messageBody,
            organizationIdFilter: orgIdFilter,
            rawPayload: msg as unknown as Record<string, unknown>,
          });

          if (outcome.duplicate) {
            duplicateEvents++;
          } else {
            processedEvents++;
          }
        }

        // 2. Process Delivery Status Progression (sent -> delivered -> read -> failed)
        for (const statusUpdate of value.statuses || []) {
          if (!statusUpdate.id || !statusUpdate.status) continue;

          const normalized = statusUpdate.status.toUpperCase();
          const mapping = this.mapMetaStatus(normalized);

          const outcome = await this.repository.applyWebhookEventAtomic({
            provider: 'META_WHATSAPP',
            providerMessageId: statusUpdate.id,
            eventStatus: normalized,
            leadTargetStatus: mapping.leadStatus,
            conversationDeliveryStatus: normalized,
            dispatchStatus: mapping.dispatchStatus,
            rawPayload: statusUpdate as unknown as Record<string, unknown>,
          });

          if (outcome.duplicate) {
            duplicateEvents++;
          } else {
            processedEvents++;
          }
        }
      }
    }

    return { processedEvents, duplicateEvents, ignored: false };
  }

  async processAfricasTalkingWebhook(
    input: AfricasTalkingWebhookInput
  ): Promise<{ mode: 'DLR' | 'INBOUND_SMS' | 'PING'; duplicate: boolean }> {
    const text = (input.text || input.message || '').trim();
    const status = (input.status || '').trim();
    const messageId = (input.id || input.messageId || '').trim();
    const rawFrom = (input.from || input.phoneNumber || input.sender || '').trim();

    // Case 1: Delivery Report (DLR)
    if (status && !text) {
      if (!messageId) {
        return { mode: 'DLR', duplicate: false };
      }

      const normalizedStatus = status.toUpperCase();
      const mapping = this.mapAtDlrStatus(normalizedStatus);

      const outcome = await this.repository.applyWebhookEventAtomic({
        provider: 'AFRICAS_TALKING',
        providerMessageId: messageId,
        eventStatus: normalizedStatus,
        leadTargetStatus: mapping.leadStatus,
        conversationDeliveryStatus: normalizedStatus,
        dispatchStatus: mapping.dispatchStatus,
        rawPayload: {
          status,
          networkCode: input.networkCode ?? null,
          failureReason: input.failureReason ?? null,
          receivedAt: new Date().toISOString(),
        },
      });

      return { mode: 'DLR', duplicate: outcome.duplicate };
    }

    // Case 2: Two-Way Inbound SMS
    if (text && rawFrom) {
      const normalized = validateAndFormatPhone(
        rawFrom.startsWith('+') ? rawFrom : `+${rawFrom}`
      );
      const senderE164 = normalized.isValid
        ? normalized.e164
        : rawFrom.startsWith('+')
          ? rawFrom
          : `+${rawFrom}`;

      const outcome = await this.repository.recordInboundWebhookMessage({
        provider: 'AFRICAS_TALKING',
        providerMessageId:
          messageId ||
          `at-in-${crypto
            .createHash('sha256')
            .update(`${senderE164}:${text}:${input.networkCode || ''}`)
            .digest('hex')
            .slice(0, 24)}`,
        senderPhoneE164: senderE164,
        channel: 'sms',
        messageBody: text,
        rawPayload: {
          from: senderE164,
          text,
          networkCode: input.networkCode ?? null,
        },
      });

      return { mode: 'INBOUND_SMS', duplicate: outcome.duplicate };
    }

    return { mode: 'PING', duplicate: false };
  }

  private mapMetaStatus(status: string): {
    leadStatus: LeadStatus | null;
    dispatchStatus: DispatchStatus | null;
  } {
    switch (status) {
      case 'SENT':
        return { leadStatus: 'SENT', dispatchStatus: 'SUCCESS' };
      case 'DELIVERED':
        return { leadStatus: 'DELIVERED', dispatchStatus: 'SUCCESS' };
      case 'READ':
        return { leadStatus: 'DELIVERED', dispatchStatus: 'SUCCESS' };
      case 'FAILED':
        return { leadStatus: null, dispatchStatus: 'FAILED' };
      default:
        return { leadStatus: null, dispatchStatus: null };
    }
  }

  private mapAtDlrStatus(status: string): {
    leadStatus: LeadStatus | null;
    dispatchStatus: DispatchStatus | null;
  } {
    switch (status) {
      case 'SENT':
        return { leadStatus: 'SENT', dispatchStatus: 'SUCCESS' };
      case 'SUCCESS':
      case 'DELIVERED':
        return { leadStatus: 'DELIVERED', dispatchStatus: 'SUCCESS' };
      case 'FAILED':
      case 'REJECTED':
        return { leadStatus: null, dispatchStatus: 'FAILED' };
      default:
        return { leadStatus: null, dispatchStatus: null };
    }
  }
}
