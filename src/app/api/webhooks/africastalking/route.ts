import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAppServices } from '@/lib/container';
import type { AfricasTalkingWebhookInput } from '@/services/webhook-processor.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyAfricasTalkingSecret(req: NextRequest): boolean {
  const secret = process.env.AFRICASTALKING_WEBHOOK_SECRET?.trim();
  if (!secret) return true;

  const provided =
    req.headers.get('x-at-webhook-secret')?.trim() ||
    req.nextUrl.searchParams.get('token')?.trim() ||
    '';

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(secret, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * POST /api/webhooks/africastalking
 * Handles Africa's Talking Delivery Reports (DLR) and Two-Way Inbound SMS idempotently.
 */
export async function POST(req: NextRequest) {
  try {
    if (!verifyAfricasTalkingSecret(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const contentType = req.headers.get('content-type') || '';
    let payload: AfricasTalkingWebhookInput;

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData();
      payload = {
        from: formData.get('from')?.toString(),
        phoneNumber: formData.get('phoneNumber')?.toString(),
        text: formData.get('text')?.toString(),
        id: formData.get('id')?.toString(),
        status: formData.get('status')?.toString(),
        networkCode: formData.get('networkCode')?.toString(),
        failureReason: formData.get('failureReason')?.toString(),
      };
    } else {
      payload = (await req.json()) as AfricasTalkingWebhookInput;
    }

    const { webhookProcessorService } = getAppServices();
    await webhookProcessorService.processAfricasTalkingWebhook(payload);

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error("Africa's Talking webhook error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
