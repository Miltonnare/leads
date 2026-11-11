'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  MessageSquare,
  PhoneCall,
  Zap,
} from 'lucide-react';
import {
  DemoQueryParamsSchema,
  getNichePreset,
  toTenantSlug,
  validateAndFormatPhone,
  type LeadSubmissionResponse,
  type NicheKey,
  type TelemetryStep,
} from '@/core/domain';

const CUSTOM_SERVICE_SENTINEL = '__CUSTOM_SERVICE__';

interface ParsedDemoConfig {
  clientName: string;
  organizationSlug: string;
  brandColorHex: string;
  brandColorRgb: string;
  ownerPhone: string;
  niche: NicheKey;
  customServices?: string[];
  exp?: number;
  sig?: string;
  hasSignatureParams: boolean;
}

function hexToRgbTriplet(hex: string): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) {
    return '37 99 235';
  }
  return `${r} ${g} ${b}`;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'CO';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function parseSanitizedDemoParams(searchParams: URLSearchParams): ParsedDemoConfig {
  const parsed = DemoQueryParamsSchema.safeParse({
    client: searchParams.get('client') ?? undefined,
    color: searchParams.get('color') ?? undefined,
    phone: searchParams.get('phone') ?? undefined,
    niche: searchParams.get('niche') ?? undefined,
    services: searchParams.get('services') ?? undefined,
    exp: searchParams.get('exp') ?? undefined,
    sig: searchParams.get('sig') ?? undefined,
  });

  if (!parsed.success) {
    return {
      clientName: 'Instant Estimator Corp',
      organizationSlug: 'instant-estimator-corp',
      brandColorHex: '#2563EB',
      brandColorRgb: '37 99 235',
      ownerPhone: '+254712345678',
      niche: 'general',
      hasSignatureParams: false,
    };
  }

  const data = parsed.data;
  const brandColorHex = `#${data.color}`;
  return {
    clientName: data.client,
    organizationSlug: toTenantSlug(data.client),
    brandColorHex,
    brandColorRgb: hexToRgbTriplet(brandColorHex),
    ownerPhone: data.phone,
    niche: data.niche,
    customServices: data.services,
    exp: data.exp,
    sig: data.sig,
    hasSignatureParams: Boolean(data.sig && data.exp),
  };
}

export function ChameleonContent() {
  const searchParams = useSearchParams();

  // 1. Sanitized URL parsing & safe CSS custom property injection
  const demoConfig = useMemo(
    () => parseSanitizedDemoParams(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );

  const themeStyle = useMemo(
    () =>
      ({
        '--brand-color': demoConfig.brandColorHex,
        '--brand-color-rgb': demoConfig.brandColorRgb,
      }) as React.CSSProperties,
    [demoConfig.brandColorHex, demoConfig.brandColorRgb]
  );

  const activeNiche = useMemo(
    () => getNichePreset(demoConfig.niche, demoConfig.clientName),
    [demoConfig.niche, demoConfig.clientName]
  );

  const serviceOptions = useMemo(
    () => demoConfig.customServices ?? activeNiche.services,
    [demoConfig.customServices, activeNiche.services]
  );

  const defaultServiceOption = serviceOptions[0] || activeNiche.defaultService;

  const clientInitials = useMemo(
    () => getInitials(demoConfig.clientName),
    [demoConfig.clientName]
  );

  // 2. Form & micro-validation state
  const [fullName, setFullName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [phone, setPhone] = useState('');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [serviceSelected, setServiceSelected] = useState(defaultServiceOption);
  const [customServiceText, setCustomServiceText] = useState('');
  const [customServiceTouched, setCustomServiceTouched] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [consentTouched, setConsentTouched] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'form' | 'telemetry'>('form');

  const [submitResult, setSubmitResult] = useState<
    (LeadSubmissionResponse & { roundTripMs?: number }) | null
  >(null);
  const [telemetry, setTelemetry] = useState<TelemetryStep[]>([]);

  useEffect(() => {
    setServiceSelected(defaultServiceOption);
  }, [defaultServiceOption]);

  const isCustomService = serviceSelected === CUSTOM_SERVICE_SENTINEL;
  const resolvedServiceRequested = isCustomService
    ? customServiceText.trim()
    : serviceSelected;

  const phoneValidation = useMemo(() => validateAndFormatPhone(phone), [phone]);
  const isNameValid = fullName.trim().length >= 2;
  const isServiceValid = resolvedServiceRequested.length >= 2;
  const showNameError = nameTouched && !isNameValid;
  const showPhoneError = phoneTouched && phone.trim().length > 0 && !phoneValidation.isValid;
  const showPhoneEmptyError = phoneTouched && phone.trim().length === 0;
  const showCustomServiceError = isCustomService && customServiceTouched && !isServiceValid;
  const showConsentError = consentTouched && !consentAccepted;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameTouched(true);
    setPhoneTouched(true);
    if (isCustomService) {
      setCustomServiceTouched(true);
    }
    setConsentTouched(true);

    if (!isNameValid || !phoneValidation.isValid || !isServiceValid || !consentAccepted) {
      return;
    }

    setIsSubmitting(true);
    setSubmitResult(null);

    const t0 = performance.now();

    setTelemetry([
      {
        step: 'client_submit',
        label: 'Intake request dispatched',
        durationMs: null,
        status: 'QUEUED_ASYNC',
      },
    ]);

    try {
      const response = await fetch('/api/leads/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phoneValidation.e164,
          serviceRequested: resolvedServiceRequested,
          organizationSlug: demoConfig.organizationSlug,
          ownerPhone: demoConfig.ownerPhone,
          demoContext: {
            client: demoConfig.clientName,
            color: demoConfig.brandColorHex.replace('#', ''),
            phone: demoConfig.ownerPhone,
            niche: demoConfig.niche,
            exp: demoConfig.exp,
            sig: demoConfig.sig,
          },
          consentAccepted,
          privacyNoticeVersion: '2026-11-odpc-v1',
          metadata: {
            niche: demoConfig.niche,
            source: 'web_intake',
          },
          attribution: {
            utm_source: searchParams.get('utm_source')?.slice(0, 100) || 'direct',
            utm_medium: 'web',
            utm_campaign: searchParams.get('utm_campaign')?.slice(0, 100) || 'estimate_request',
          },
        }),
      });

      const data = (await response.json()) as LeadSubmissionResponse;
      const roundTripMs = Math.round(performance.now() - t0);

      if (data.telemetry && data.telemetry.length > 0) {
        setTelemetry([
          ...data.telemetry,
          {
            step: 'round_trip',
            label: 'End-to-end HTTP round trip',
            durationMs: roundTripMs,
            status: 'COMPLETED',
          },
        ]);
      }

      if (response.ok && data.success) {
        setSubmitResult({ ...data, roundTripMs });
      } else {
        setSubmitResult({
          success: false,
          status: 'FAILED',
          message: data.error || data.message || 'Submission failed.',
          error: data.error || 'Unable to process request. Please verify your mobile number.',
          roundTripMs,
        });
      }
    } catch (err) {
      setSubmitResult({
        success: false,
        status: 'FAILED',
        message: 'Network error while submitting request.',
        error: err instanceof Error ? err.message : 'Network error while submitting request.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setSubmitResult(null);
    setFullName('');
    setPhone('');
    setServiceSelected(defaultServiceOption);
    setCustomServiceText('');
    setCustomServiceTouched(false);
    setConsentAccepted(false);
    setNameTouched(false);
    setPhoneTouched(false);
    setConsentTouched(false);
  };

  return (
    <div style={themeStyle} className="min-h-screen bg-canvas text-ink flex flex-col">
      {/* Crisp White-Label Navigation Header */}
      <header className="sticky top-0 z-20 w-full bg-surface/95 backdrop-blur-sm border-b border-surface-border">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-brand/10 border border-brand/20 text-brand flex items-center justify-center text-xs font-semibold tracking-tight shrink-0">
              {clientInitials}
            </div>
            <span className="font-semibold text-sm text-ink tracking-tight truncate">
              {demoConfig.clientName}
            </span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <a
              href={`tel:${demoConfig.ownerPhone}`}
              className="hidden sm:inline-flex items-center gap-1.5 text-xs font-mono font-medium text-ink-muted hover:text-ink px-2.5 py-1.5 rounded-lg border border-surface-border bg-canvas transition-colors"
            >
              <PhoneCall className="w-3.5 h-3.5 text-brand" />
              <span>{demoConfig.ownerPhone}</span>
            </a>

            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-surface-border bg-surface text-ink-muted">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  demoConfig.hasSignatureParams ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              <span>{demoConfig.hasSignatureParams ? 'Live Dispatch' : 'Sandbox'}</span>
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Compact Executive Hero */}
        <section className="text-center max-w-2xl mx-auto mb-7 space-y-3">
          <div className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-brand/10 text-brand">
            {activeNiche.badge}
          </div>

          <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight text-ink leading-tight">
            {activeNiche.headline}
          </h1>

          <p className="text-sm sm:text-base text-ink-muted leading-relaxed max-w-xl mx-auto">
            {activeNiche.subhead}
          </p>
        </section>

        {/* Single-Column Intake & Diagnostics Card */}
        <section className="max-w-xl mx-auto bg-surface border border-surface-border rounded-2xl shadow-card overflow-hidden">
          {/* Segmented Navigation Tabs */}
          <div className="grid grid-cols-2 border-b border-surface-border bg-canvas/60">
            <button
              type="button"
              onClick={() => setActiveTab('form')}
              className={`py-3 px-4 text-xs sm:text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${
                activeTab === 'form'
                  ? 'border-brand text-ink bg-surface'
                  : 'border-transparent text-ink-muted hover:text-ink'
              }`}
            >
              <Zap className={`w-4 h-4 ${activeTab === 'form' ? 'text-brand' : 'text-ink-muted'}`} />
              <span>Request Estimate</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('telemetry')}
              className={`py-3 px-4 text-xs sm:text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${
                activeTab === 'telemetry'
                  ? 'border-brand text-ink bg-surface'
                  : 'border-transparent text-ink-muted hover:text-ink'
              }`}
            >
              <Clock
                className={`w-4 h-4 ${activeTab === 'telemetry' ? 'text-brand' : 'text-ink-muted'}`}
              />
              <span>Speed Diagnostics</span>
              {submitResult?.intakeLatencyMs !== undefined && (
                <span className="px-1.5 py-0.5 rounded-md text-[11px] font-mono tabular-nums bg-brand/10 text-brand">
                  {submitResult.intakeLatencyMs}ms
                </span>
              )}
            </button>
          </div>

          <div className="p-5 sm:p-7">
            {activeTab === 'form' ? (
              submitResult && submitResult.success ? (
                /* Soft Emerald Success Confirmation */
                <div className="space-y-5">
                  <div className="rounded-xl bg-[#F0FDF4] border border-emerald-200 p-4 flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    <div className="space-y-1 min-w-0">
                      <h2 className="text-sm font-semibold text-ink tracking-tight">
                        {submitResult.executionMode === 'SANDBOX_SIMULATION'
                          ? 'Estimate logged in sandbox simulation'
                          : 'Request confirmed and specialist alerted'}
                      </h2>
                      <p className="text-xs text-ink-muted leading-relaxed">
                        {submitResult.message}
                      </p>
                    </div>
                  </div>

                  {/* Clean Diagnostic Pills */}
                  <div className="grid grid-cols-3 gap-2.5 text-left">
                    <div className="p-3 rounded-xl bg-canvas border border-surface-border">
                      <div className="text-[11px] font-medium text-ink-muted">API Intake</div>
                      <div className="text-sm font-mono font-semibold text-ink tabular-nums mt-0.5">
                        {submitResult.intakeLatencyMs ?? submitResult.roundTripMs ?? 0}ms
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-canvas border border-surface-border">
                      <div className="text-[11px] font-medium text-ink-muted">DB Commit</div>
                      <div className="text-sm font-mono font-semibold text-ink tabular-nums mt-0.5">
                        {submitResult.dbLatencyMs !== undefined
                          ? `${submitResult.dbLatencyMs}ms`
                          : '—'}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-canvas border border-surface-border">
                      <div className="text-[11px] font-medium text-ink-muted">Status</div>
                      <div className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-ink mt-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span>{submitResult.status}</span>
                      </div>
                    </div>
                  </div>

                  {/* Thumb-Friendly Demo / SLA Actions */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <a
                      href={
                        submitResult.leadId
                          ? `/r/wa/${submitResult.leadId}`
                          : `https://wa.me/${phoneValidation.e164.replace(/[^0-9]/g, '')}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[48px] px-4 py-3 rounded-xl bg-brand text-white font-medium text-sm flex items-center justify-center gap-2 shadow-subtle hover:opacity-95 active:scale-[0.99] transition-all"
                    >
                      <MessageSquare className="w-4 h-4 shrink-0" />
                      <span>Open Customer WhatsApp</span>
                    </a>

                    <a
                      href={
                        submitResult.leadId
                          ? `/r/call/${submitResult.leadId}`
                          : `tel:${demoConfig.ownerPhone}`
                      }
                      className="min-h-[48px] px-4 py-3 rounded-xl bg-surface text-ink border border-surface-border font-medium text-sm flex items-center justify-center gap-2 shadow-subtle hover:bg-canvas active:scale-[0.99] transition-all"
                    >
                      <PhoneCall className="w-4 h-4 text-brand shrink-0" />
                      <span>Test Owner 1-Tap Dialer</span>
                    </a>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-surface-border text-xs">
                    <button
                      type="button"
                      onClick={() => setActiveTab('telemetry')}
                      className="font-medium text-brand hover:underline"
                    >
                      View speed breakdown
                    </button>
                    <button
                      type="button"
                      onClick={resetForm}
                      className="font-medium text-ink-muted hover:text-ink"
                    >
                      Submit another inquiry
                    </button>
                  </div>
                </div>
              ) : (
                /* Single-Column High-Converting Intake Form */
                <form onSubmit={handleSubmit} noValidate className="space-y-4">
                  {submitResult && !submitResult.success && (
                    <div className="rounded-xl bg-[#FFF1F2] border border-rose-200 p-3.5 flex items-start gap-2.5 text-rose-900">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <div className="text-xs leading-relaxed">
                        <span className="font-semibold block">Submission blocked</span>
                        <span>{submitResult.error}</span>
                      </div>
                    </div>
                  )}

                  {/* Full Name Field */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="lead-full-name"
                        className="block text-xs font-medium text-ink"
                      >
                        Full Name or Company Contact
                      </label>
                      {nameTouched && isNameValid && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-[#F0FDF4] px-2 py-0.5 rounded-full border border-emerald-200">
                          <Check className="w-3 h-3" /> Verified
                        </span>
                      )}
                    </div>
                    <input
                      id="lead-full-name"
                      type="text"
                      required
                      maxLength={100}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      onBlur={() => setNameTouched(true)}
                      placeholder="e.g. Eng. David Maina"
                      aria-invalid={showNameError}
                      className={`w-full h-11 px-3.5 rounded-xl text-sm text-ink placeholder:text-ink-muted/50 border transition-all focus:outline-none ${
                        showNameError
                          ? 'bg-[#FFF1F2] border-rose-300 focus:border-rose-400 focus:ring-4 focus:ring-rose-100'
                          : 'bg-surface border-surface-border focus:border-brand focus:ring-4 focus:ring-brand/15'
                      }`}
                    />
                    {showNameError && (
                      <p className="text-xs text-rose-700">
                        Please enter at least 2 characters for your name.
                      </p>
                    )}
                  </div>

                  {/* Mobile Phone Field */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="lead-phone" className="block text-xs font-medium text-ink">
                        Mobile Phone Number
                      </label>
                      {phoneValidation.isValid ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-mono font-medium text-emerald-700 bg-[#F0FDF4] px-2 py-0.5 rounded-full border border-emerald-200">
                          <Check className="w-3 h-3" />
                          <span>{phoneValidation.e164}</span>
                        </span>
                      ) : (
                        <span className="text-[11px] font-mono text-ink-muted/75">
                          07XX / 01XX / +254
                        </span>
                      )}
                    </div>
                    <input
                      id="lead-phone"
                      type="tel"
                      required
                      maxLength={25}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      onBlur={() => setPhoneTouched(true)}
                      placeholder="0712 345 678 or +254 712 345 678"
                      aria-invalid={showPhoneError || showPhoneEmptyError}
                      className={`w-full h-11 px-3.5 rounded-xl text-sm font-mono text-ink placeholder:text-ink-muted/50 border transition-all focus:outline-none ${
                        showPhoneError || showPhoneEmptyError
                          ? 'bg-[#FFF1F2] border-rose-300 focus:border-rose-400 focus:ring-4 focus:ring-rose-100'
                          : 'bg-surface border-surface-border focus:border-brand focus:ring-4 focus:ring-brand/15'
                      }`}
                    />
                    {(showPhoneError || showPhoneEmptyError) && (
                      <p className="text-xs text-rose-700">
                        Enter a valid Kenyan (07XX / 01XX / +254) or international mobile number.
                      </p>
                    )}
                  </div>

                  {/* Service Requirement Select + Custom Free-Text Option */}
                  <div className="space-y-1.5">
                    <label htmlFor="lead-service" className="block text-xs font-medium text-ink">
                      Project / Service Requirement
                    </label>
                    <div className="relative">
                      <select
                        id="lead-service"
                        value={serviceSelected}
                        onChange={(e) => {
                          setServiceSelected(e.target.value);
                          if (e.target.value !== CUSTOM_SERVICE_SENTINEL) {
                            setCustomServiceTouched(false);
                          }
                        }}
                        className="w-full h-11 pl-3.5 pr-10 rounded-xl text-sm text-ink bg-surface border border-surface-border appearance-none transition-all focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/15"
                      >
                        {serviceOptions.map((svc) => (
                          <option key={svc} value={svc}>
                            {svc}
                          </option>
                        ))}
                        <option value={CUSTOM_SERVICE_SENTINEL}>
                          Other (Specify custom requirement)
                        </option>
                      </select>
                      <ChevronDown className="w-4 h-4 text-ink-muted pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2" />
                    </div>

                    {isCustomService && (
                      <div className="pt-1.5 space-y-1">
                        <input
                          id="lead-custom-service"
                          type="text"
                          required
                          maxLength={150}
                          value={customServiceText}
                          onChange={(e) => setCustomServiceText(e.target.value)}
                          onBlur={() => setCustomServiceTouched(true)}
                          placeholder="Describe your specific project or service requirement..."
                          aria-invalid={showCustomServiceError}
                          className={`w-full h-11 px-3.5 rounded-xl text-sm text-ink placeholder:text-ink-muted/50 border transition-all focus:outline-none ${
                            showCustomServiceError
                              ? 'bg-[#FFF1F2] border-rose-300 focus:border-rose-400 focus:ring-4 focus:ring-rose-100'
                              : 'bg-surface border-surface-border focus:border-brand focus:ring-4 focus:ring-brand/15'
                          }`}
                        />
                        {showCustomServiceError && (
                          <p className="text-xs text-rose-700">
                            Please describe your project requirement (minimum 2 characters).
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Unbundled ODPC Affirmative Consent Checkbox */}
                  <div
                    className={`rounded-xl border p-3 transition-colors ${
                      showConsentError
                        ? 'bg-[#FFF1F2] border-rose-300'
                        : 'bg-canvas border-surface-border'
                    }`}
                  >
                    <label className="flex items-start gap-2.5 cursor-pointer text-xs text-ink-muted leading-relaxed">
                      <input
                        type="checkbox"
                        checked={consentAccepted}
                        onChange={(e) => {
                          setConsentAccepted(e.target.checked);
                          setConsentTouched(true);
                        }}
                        className="mt-0.5 h-4 w-4 rounded border-surface-border accent-brand focus:ring-brand/25 shrink-0"
                      />
                      <span>
                        I consent to{' '}
                        <strong className="text-ink font-medium">{demoConfig.clientName}</strong>{' '}
                        contacting me via WhatsApp, SMS, or phone regarding this quote, and
                        acknowledge the{' '}
                        <a
                          href={`/privacy?client=${encodeURIComponent(demoConfig.clientName)}&phone=${encodeURIComponent(demoConfig.ownerPhone)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand font-medium hover:underline"
                        >
                          Privacy &amp; Data Processing Notice
                        </a>
                        .
                      </span>
                    </label>
                    {showConsentError && (
                      <p className="text-xs text-rose-700 mt-1.5 pl-6">
                        Please confirm consent before submitting your request.
                      </p>
                    )}
                  </div>

                  {/* Primary Brand CTA */}
                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-brand text-white font-medium text-sm shadow-subtle hover:opacity-95 active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-4 focus:ring-brand/25"
                    >
                      {isSubmitting ? (
                        <>
                          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>Dispatching Estimate Request...</span>
                        </>
                      ) : (
                        <>
                          <span>{activeNiche.cta}</span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>

                  {/* Subtle Mobile Dialer Shortcut */}
                  <div className="flex items-center justify-between pt-1 text-xs text-ink-muted">
                    <span>Direct technical callback under 15 seconds</span>
                    <a
                      href={`tel:${demoConfig.ownerPhone}`}
                      className="sm:hidden font-mono font-medium text-brand hover:underline"
                    >
                      Call {demoConfig.ownerPhone}
                    </a>
                  </div>
                </form>
              )
            ) : (
              /* Clean Tabular Speed Diagnostics Tab */
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-ink tracking-tight">
                      Execution Speed Breakdown
                    </h2>
                    <p className="text-xs text-ink-muted mt-0.5">
                      Measured server intake and asynchronous dispatch stages
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium bg-brand/10 text-brand shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand" />
                    <span>Target &lt;250ms</span>
                  </span>
                </div>

                {/* Compact 3-Column Metric Summary */}
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="p-3 rounded-xl bg-canvas border border-surface-border">
                    <div className="text-[11px] text-ink-muted font-medium">API Intake</div>
                    <div className="text-base font-mono font-semibold text-ink tabular-nums mt-0.5">
                      {submitResult?.intakeLatencyMs !== undefined
                        ? `${submitResult.intakeLatencyMs}ms`
                        : '—'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-canvas border border-surface-border">
                    <div className="text-[11px] text-ink-muted font-medium">Atomic DB</div>
                    <div className="text-base font-mono font-semibold text-ink tabular-nums mt-0.5">
                      {submitResult?.dbLatencyMs !== undefined
                        ? `${submitResult.dbLatencyMs}ms`
                        : '—'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-canvas border border-surface-border">
                    <div className="text-[11px] text-ink-muted font-medium">Round Trip</div>
                    <div className="text-base font-mono font-semibold text-ink tabular-nums mt-0.5">
                      {submitResult?.roundTripMs !== undefined
                        ? `${submitResult.roundTripMs}ms`
                        : '—'}
                    </div>
                  </div>
                </div>

                {/* Compact Strategy & Mode Strip */}
                {submitResult && (
                  <div className="grid grid-cols-2 gap-2.5 text-xs">
                    <div className="px-3 py-2 rounded-xl bg-surface border border-surface-border flex items-center justify-between gap-2">
                      <span className="text-ink-muted font-medium">Execution</span>
                      <span className="font-mono font-semibold text-ink">
                        {submitResult.executionMode || '—'}
                      </span>
                    </div>
                    <div className="px-3 py-2 rounded-xl bg-surface border border-surface-border flex items-center justify-between gap-2">
                      <span className="text-ink-muted font-medium">Dispatch</span>
                      <span className="font-mono font-semibold text-ink">
                        {submitResult.dispatchMode || '—'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Hairline Table of Pipeline Stages */}
                <div className="border border-surface-border rounded-xl overflow-hidden bg-surface">
                  <div className="grid grid-cols-[1fr_auto] px-3.5 py-2 bg-canvas border-b border-surface-border text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                    <span>Pipeline Stage</span>
                    <span>Timing / State</span>
                  </div>

                  {telemetry.length > 0 ? (
                    <div className="divide-y divide-surface-border">
                      {telemetry.map((item) => (
                        <div
                          key={item.step}
                          className="grid grid-cols-[1fr_auto] items-center gap-3 px-3.5 py-2.5 text-xs"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                item.status === 'COMPLETED'
                                  ? 'bg-emerald-500'
                                  : item.status === 'SIMULATED'
                                    ? 'bg-amber-500'
                                    : 'bg-brand'
                              }`}
                            />
                            <span className="text-ink truncate">{item.label}</span>
                          </div>
                          <span className="font-mono font-medium text-ink-muted tabular-nums whitespace-nowrap">
                            {item.durationMs !== null ? `${item.durationMs}ms` : item.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-8 text-center text-xs text-ink-muted">
                      Submit an estimate request to view live stage timings.
                    </div>
                  )}
                </div>

                {/* Diagnostic Action Pills when a lead exists */}
                {submitResult?.success && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    <a
                      href={
                        submitResult.leadId
                          ? `/r/wa/${submitResult.leadId}`
                          : `https://wa.me/${phoneValidation.e164.replace(/[^0-9]/g, '')}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[44px] px-3.5 py-2.5 rounded-xl bg-brand/10 text-brand border border-brand/20 font-medium text-xs flex items-center justify-center gap-2 hover:bg-brand/15 transition-colors"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Open Customer WhatsApp</span>
                    </a>
                    <a
                      href={
                        submitResult.leadId
                          ? `/r/call/${submitResult.leadId}`
                          : `tel:${demoConfig.ownerPhone}`
                      }
                      className="min-h-[44px] px-3.5 py-2.5 rounded-xl bg-canvas text-ink border border-surface-border font-medium text-xs flex items-center justify-center gap-2 hover:bg-surface shadow-sm transition-colors"
                    >
                      <PhoneCall className="w-3.5 h-3.5 text-brand" />
                      <span>Test Owner 1-Tap Dialer</span>
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
