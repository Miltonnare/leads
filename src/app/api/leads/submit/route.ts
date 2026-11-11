import { NextRequest, NextResponse } from 'next/server';
import { scheduleBackgroundTask } from '@/adapters/runtime/background';
import { getAppServices } from '@/lib/container';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Ensures Vercel Fluid Compute / waitUntil async dispatches & waterfall timers never clip at 10s
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, status: 'FAILED', error: 'Malformed JSON body' },
        { status: 400 }
      );
    }

    const ipAddress =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      req.ip ||
      '127.0.0.1';
    const userAgent = req.headers.get('user-agent') || 'Unknown';
    const appBaseUrl =
      process.env.NEXT_PUBLIC_APP_URL?.trim() || req.nextUrl.origin;

    const { leadDispatchService } = getAppServices();
    const outcome = await leadDispatchService.handleLeadIntake(rawBody, {
      ipAddress,
      userAgent,
      appBaseUrl,
    });

    if (outcome.backgroundTask) {
      scheduleBackgroundTask('lead-dispatch', outcome.backgroundTask);
    }

    return NextResponse.json(outcome.body, { status: outcome.httpStatus });
  } catch (err) {
    console.error('Lead intake exception:', err);
    return NextResponse.json(
      {
        success: false,
        status: 'FAILED',
        error: 'Internal server error during lead intake processing',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
