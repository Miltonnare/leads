import { NextRequest, NextResponse } from 'next/server';
import { getAppServices } from '@/lib/container';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/webhooks/whatsapp
 * Meta Developer Console webhook challenge verification.
 */
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const expectedToken =
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'CHAMELEON_VERIFY_SECRET_2026';

  if (mode === 'subscribe' && token === expectedToken) {
    return new Response(challenge, { status: 200 });
  }

  return NextResponse.json(
    { error: 'Forbidden. Webhook verification token mismatch.' },
    { status: 403 }
  );
}

/**
 * POST /api/webhooks/whatsapp
 * Idempotent Meta WhatsApp Cloud API event notification handler.
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-hub-signature-256');
    const { webhookProcessorService } = getAppServices();

    if (!webhookProcessorService.verifyMetaSignature(rawBody, signature)) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid signature' },
        { status: 401 }
      );
    }

    const parsedBody = JSON.parse(rawBody);
    const result = await webhookProcessorService.processWhatsAppWebhook(parsedBody);

    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (err) {
    console.error('WhatsApp webhook processing error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
