import React, { Suspense } from 'react';
import type { Metadata } from 'next';
import { DemoQueryParamsSchema } from '@/core/domain';
import { ChameleonContent } from '@/components/ChameleonContent';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const clientParam = Array.isArray(searchParams?.client)
    ? searchParams?.client[0]
    : searchParams?.client;

  const parsed = DemoQueryParamsSchema.safeParse({ client: clientParam });
  const clientName = parsed.success ? parsed.data.client : 'Instant Estimator Corp';

  return {
    title: `${clientName} | Instant Quote & Specialist Dispatch`,
    description: `Request an immediate technical quote and direct callback from ${clientName}.`,
  };
}

export default function ChameleonPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
          <div className="w-full max-w-xl bg-surface border border-surface-border rounded-2xl p-8 shadow-subtle space-y-4 animate-pulse">
            <div className="h-4 w-32 bg-slate-200 rounded" />
            <div className="h-7 w-3/4 bg-slate-200 rounded" />
            <div className="h-11 w-full bg-slate-100 rounded-xl" />
            <div className="h-11 w-full bg-slate-100 rounded-xl" />
            <div className="h-12 w-full bg-slate-200 rounded-xl" />
          </div>
        </div>
      }
    >
      <ChameleonContent />
    </Suspense>
  );
}
