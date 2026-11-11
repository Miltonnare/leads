import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAppServices } from '@/lib/container';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return process.env.NODE_ENV !== 'production';
  }

  const provided =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ||
    req.headers.get('x-cron-secret')?.trim() ||
    '';

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(secret, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handleSlaSweep(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || req.nextUrl.origin;
    const { leadDispatchService } = getAppServices();

    const result = await leadDispatchService.runSlaEscalationSweep({
      appBaseUrl,
      escalateAfterSeconds: Number(process.env.SLA_ESCALATE_AFTER_SECONDS || 300),
      expireAfterSeconds: Number(process.env.SLA_EXPIRE_AFTER_SECONDS || 3600),
      limit: 25,
    });

    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (err) {
    console.error('SLA escalation cron error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'SLA sweep failed' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return handleSlaSweep(req);
}

export async function POST(req: NextRequest) {
  return handleSlaSweep(req);
}
