import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { UuidSchema } from '@/core/domain';
import { getAppServices } from '@/lib/container';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ChannelSchema = z.enum(['call', 'wa']);

/**
 * GET /r/[channel]/[leadId]
 * 1-Tap SLA Click Tracker:
 *   - /r/call/[leadId] -> Logs OWNER_CLICKED_CALL timestamp, then 302 redirects to tel:+254...
 *   - /r/wa/[leadId]   -> Logs OWNER_CLICKED_WA timestamp, then 302 redirects to https://wa.me/254...?text=...
 */
export async function GET(
  req: NextRequest,
  context: { params: { channel: string; leadId: string } }
) {
  const channelParse = ChannelSchema.safeParse(context.params.channel?.toLowerCase());
  const leadIdParse = UuidSchema.safeParse(context.params.leadId);

  if (!channelParse.success || !leadIdParse.success) {
    return NextResponse.json(
      { error: 'Invalid tracking link parameters' },
      { status: 400 }
    );
  }

  const channel = channelParse.data;
  const leadId = leadIdParse.data;

  try {
    const ipAddress =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      req.ip ||
      null;
    const userAgent = req.headers.get('user-agent') || null;

    const { repository } = getAppServices();
    const target = await repository.recordOwnerClickSla({
      leadId,
      channel,
      ipAddress,
      userAgent,
    });

    if (!target) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    if (channel === 'call') {
      const telTarget = `tel:${target.customerPhoneE164}`;
      return new Response(null, {
        status: 302,
        headers: {
          Location: telTarget,
          'Cache-Control': 'no-store, max-age=0',
        },
      });
    }

    const waDigits = target.customerPhoneE164.replace(/[^0-9]/g, '');
    const prefilledGreeting = encodeURIComponent(
      `Hello ${target.customerName}, this is ${target.organizationName} following up on your ${target.serviceRequested} inquiry.`
    );
    const waTarget = `https://wa.me/${waDigits}?text=${prefilledGreeting}`;

    return new Response(null, {
      status: 302,
      headers: {
        Location: waTarget,
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (err) {
    console.error('Owner SLA click tracking error:', err);
    return NextResponse.json(
      { error: 'Unable to process click redirect' },
      { status: 500 }
    );
  }
}
