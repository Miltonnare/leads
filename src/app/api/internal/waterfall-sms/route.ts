import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAppServices } from '@/lib/container';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WaterfallCallbackSchema = z.object({
  leadId: z.string().uuid(),
  tenantSlug: z.string().min(2),
  customerName: z.string().min(1),
  customerPhoneE164: z.string().min(8),
  serviceRequested: z.string().min(1),
});

function isAuthorizedInternalCall(req: NextRequest): boolean {
  const configured = process.env.INTERNAL_CALLBACK_SECRET?.trim();
  if (!configured) return false;

  const provided = req.headers.get('x-internal-secret')?.trim() || '';
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(configured, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * POST /api/internal/waterfall-sms
 * Optional QStash delayed callback for WATERFALL_PROD SMS fallback.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorizedInternalCall(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const parsed = WaterfallCallbackSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid waterfall payload' }, { status: 400 });
    }

    const { repository, leadDispatchService } = getAppServices();
    const tenant = await repository.resolveBySlug(parsed.data.tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const result = await leadDispatchService.executeWaterfallSmsFallback({
      leadId: parsed.data.leadId,
      tenant,
      customerPhoneE164: parsed.data.customerPhoneE164,
      customerName: parsed.data.customerName,
      serviceRequested: parsed.data.serviceRequested,
    });

    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (err) {
    console.error('Waterfall SMS callback failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Waterfall callback error' },
      { status: 500 }
    );
  }
}
