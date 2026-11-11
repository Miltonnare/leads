/**
 * Serverless Background Task Orchestrator
 * Safely schedules post-response work using Vercel's `waitUntil` runtime context
 * (with fallback for local Node.js / standalone Next.js servers) so dispatches
 * never block HTTP responses and are never killed mid-flight.
 */

const VERCEL_REQUEST_CONTEXT_SYMBOL = Symbol.for('@vercel/request-context');

interface VercelRequestContext {
  get?: () => {
    waitUntil?: (promise: Promise<unknown>) => void;
  };
}

export function scheduleBackgroundTask(
  taskName: string,
  taskPromise: Promise<unknown>
): void {
  const safePromise = taskPromise.catch((err) => {
    console.error(`[background:${taskName}] unhandled failure:`, err);
  });

  try {
    const globalObj = globalThis as Record<symbol, VercelRequestContext | undefined>;
    const vercelCtx = globalObj[VERCEL_REQUEST_CONTEXT_SYMBOL]?.get?.();

    if (vercelCtx && typeof vercelCtx.waitUntil === 'function') {
      vercelCtx.waitUntil(safePromise);
      return;
    }
  } catch (err) {
    console.warn(`[background:${taskName}] waitUntil lookup failed, falling back to detached promise:`, err);
  }

  // Fallback for local Node.js / self-hosted Next.js where event loop remains alive
  void safePromise;
}
