import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { resolvePreview } from '@/lib/preview';

interface PrivacyPageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export async function generateMetadata({ searchParams }: PrivacyPageProps): Promise<Metadata> {
  const { client: clientName } = resolvePreview(searchParams);
  return {
    title: `Privacy & Data Processing Notice | ${clientName}`,
    description: `Kenya Data Protection Act (2019) privacy notice and cross-border processing disclosures for ${clientName}.`,
  };
}

export default function PrivacyNoticePage({ searchParams }: PrivacyPageProps) {
  const { client: clientName, phone: contactPhone } = resolvePreview(searchParams);
  return (
    <main className="min-h-screen bg-canvas text-ink py-10 px-4 sm:px-6">
      <article className="max-w-2xl mx-auto bg-surface border border-surface-border rounded-2xl shadow-sm p-6 sm:p-8 space-y-6">
        <div className="flex items-center justify-between gap-4 border-b border-surface-border pb-4">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-ink-muted">
              Notice Version: 2026-11-odpc-v1
            </p>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink mt-1">
              Privacy &amp; Data Processing Notice
            </h1>
          </div>
          <Link
            href="/"
            className="min-h-[44px] inline-flex items-center text-xs font-medium text-ink-muted hover:text-ink border border-surface-border px-3 py-1.5 rounded-lg bg-canvas"
          >
            Back
          </Link>
        </div>

        <section className="space-y-2 text-sm text-ink-muted leading-relaxed">
          <h2 className="text-sm font-semibold text-ink">1. Data Controller &amp; Purpose</h2>
          <p>
            <strong className="text-ink">{clientName}</strong> collects your name, mobile phone
            number, and selected project specification strictly to prepare your requested quotation,
            confirm receipt via WhatsApp or SMS, and connect you with a technical specialist.
          </p>
        </section>

        <section className="space-y-2 text-sm text-ink-muted leading-relaxed">
          <h2 className="text-sm font-semibold text-ink">
            2. Lawful Basis &amp; Cross-Border Cloud Transfers
          </h2>
          <p>
            Processing is grounded in your explicit affirmative consent under the Kenya Data
            Protection Act (2019) and contractual necessity to fulfill your inquiry. Inquiry records
            and message delivery logs are processed securely using encrypted cloud hosting and
            telecommunications infrastructure (including Supabase, Vercel, Meta WhatsApp Cloud API,
            and Africa&apos;s Talking). These providers may process records outside Kenya. Contact the controller for the applicable destinations, transfer safeguards and retention schedule.
          </p>
        </section>

        <section className="space-y-2 text-sm text-ink-muted leading-relaxed">
          <h2 className="text-sm font-semibold text-ink">
            3. Opt-Out (STOP) &amp; Data Subject Rights
          </h2>
          <p>
            You may opt out of follow-up messages at any time by replying{' '}
            <code className="font-mono text-xs bg-canvas border border-surface-border px-1.5 py-0.5 rounded">
              STOP
            </code>{' '}
            on WhatsApp or a reply-enabled SMS number. For a branded SMS sender, contact the controller directly. You may also request access, correction, or erasure of
            your personal data by contacting <strong className="text-ink">{clientName}</strong>{' '}
            directly on <span className="font-mono text-ink">{contactPhone}</span>; access requests
            are fulfilled within 7 days in accordance with ODPC regulations.
          </p>
        </section>
      </article>
    </main>
  );
}
