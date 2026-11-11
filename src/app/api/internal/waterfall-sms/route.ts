import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAppServices } from '@/lib/container';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const WaterfallCallbackSchema = z.object({
  leadId: z.string().uuid(),
  tenantSlug: z.string().min(2),
  customerName: z.string().min(1),
  customerPhoneE164: z.string().min(8),
  serviceRequested: z.string().min(1),
});

function verifyHmacJwtSignature(
  token: string,
  signingKey: string,
  rawBody: string
): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  const expectedSig = crypto
    .createHmac('sha256', signingKey)
    .update(signingInput, 'utf8')
    .digest('base64url');

  const actualBuf = Buffer.from(sigB64, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (
    actualBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(actualBuf, expectedBuf)
  ) {
    return false;
  }

  try {
    const claims = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as {
      iss?: string;
      exp?: number;
      nbf?: number;
      body?: string;
    };

    const nowSec = Math.floor(Date.now() / 1000);
    if (claims.iss !== 'Upstash') return false;
    if (typeof claims.exp === 'number' && nowSec > claims.exp) return false;
    if (typeof claims.nbf === 'number' && nowSec < claims.nbf) return false;

    if (claims.body) {
      const actualBodyHash = crypto
        .createHash('sha256')
        .update(rawBody, 'utf8')
        .digest('base64url');
      if (claims.body !== actualBodyHash) return false;
    }

    return true;
  } catch {
    return false;
  }
}

function isAuthorizedInternalCall(req: NextRequest, rawBody: string): boolean {
  // 1. Prefer Upstash QStash cryptographic JWT signature verification
  const qstashSig = req.headers.get('upstash-signature')?.trim();
  const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY?.trim();
  const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY?.trim();

  if (qstashSig && (currentKey || nextKey)) {
    const validCurrent = currentKey
      ? verifyHmacJwtSignature(qstashSig, currentKey, rawBody)
      : false;
    const validNext = nextKey
      ? verifyHmacJwtSignature(qstashSig, nextKey, rawBody)
      : false;
    if (validCurrent || validNext) {
      return true;
    }
  }

  // 2. Fallback: constant-time verification of dedicated internal secret token
  const configured = process.env.INTERNAL_CALLBACK_SECRET?.trim();
  if (!configured) return false;

  const provided = req.headers.get('x-internal-secret')?.trim() || '';
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(configured, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * POST /api/internal/waterfall-sms
 * Delayed QStash / internal callback for WATERFALL_PROD SMS fallback.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!isAuthorizedInternalCall(req, rawBody)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const parsed = WaterfallCallbackSchema.safeParse(JSON.parse(rawBody));
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
