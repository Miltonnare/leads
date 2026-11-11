import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { AdminSignDemoSchema } from '@/core/domain';
import { getAppServices } from '@/lib/container';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorizedAdmin(req: NextRequest): boolean {
  const configuredKey = process.env.ADMIN_API_KEY?.trim();
  if (!configuredKey) return false;

  const headerKey =
    req.headers.get('x-admin-api-key')?.trim() ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ||
    '';

  const providedBuf = Buffer.from(headerKey, 'utf8');
  const expectedBuf = Buffer.from(configuredKey, 'utf8');

  return (
    providedBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(providedBuf, expectedBuf)
  );
}

/**
 * POST /api/admin/sign-demo
 * Generates an HMAC-SHA256 signed demo URL (`?client=...&color=...&phone=...&niche=...&exp=...&sig=...`)
 * authorized to execute LIVE_DISPATCH traffic.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorizedAdmin(req)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized: invalid or missing admin API key' },
      { status: 401 }
    );
  }

  try {
    const rawBody = await req.json();
    const parsed = AdminSignDemoSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid demo signing payload',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const appBaseUrl =
      process.env.NEXT_PUBLIC_APP_URL?.trim() || req.nextUrl.origin;

    const { demoSecurityService } = getAppServices();
    const signed = demoSecurityService.mintSignedDemoUrl(appBaseUrl, parsed.data);

    return NextResponse.json(
      {
        success: true,
        url: signed.url,
        exp: signed.exp,
        sig: signed.sig,
        normalizedPhone: signed.normalizedPhone,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('Admin sign-demo error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to sign demo URL',
      },
      { status: 500 }
    );
  }
}
