/**
 * Core Domain Validation Schemas & Sanitization Helpers
 * Enforces strict Zod validation and XSS sanitization across URL query params and API payloads.
 */

import { z } from 'zod';
import { SUPPORTED_NICHES } from './niches';

const DANGEROUS_CHARS_RE = /[<>`"'\\{};$]/g;
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/g;

/**
 * Strips HTML tags, script-injection characters, and control characters from untrusted text.
 */
export function sanitizePlainText(input: string, maxLength = 100): string {
  return input
    .replace(CONTROL_CHARS_RE, '')
    .replace(DANGEROUS_CHARS_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * Normalizes a hex color string to strict 6-char uppercase hex (without leading #),
 * preventing CSS injection via style attributes or CSS custom properties.
 */
export function sanitizeHexColor(raw?: string | null, fallback = '2563EB'): string {
  const stripped = (raw || '').replace(/[^0-9a-fA-F]/g, '');
  if (/^[0-9a-fA-F]{6}$/.test(stripped)) {
    return stripped.toUpperCase();
  }
  return fallback;
}

/**
 * Converts a client name or identifier to a safe URL/tenant slug.
 */
export function toTenantSlug(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug.length >= 2 ? slug : 'instant-estimator-corp';
}

export const NicheKeySchema = z.enum(SUPPORTED_NICHES);

export const HexColorSchema = z
  .string()
  .transform((val) => sanitizeHexColor(val))
  .refine((val) => /^[0-9A-F]{6}$/.test(val), 'Invalid 6-digit hex color');

export const DemoQueryParamsSchema = z.object({
  client: z
    .string()
    .max(120)
    .optional()
    .transform((val) => sanitizePlainText(val || 'Instant Estimator Corp', 80) || 'Instant Estimator Corp'),
  color: z
    .string()
    .max(16)
    .optional()
    .transform((val) => sanitizeHexColor(val, '2563EB')),
  phone: z
    .string()
    .max(30)
    .optional()
    .transform((val) => (val || '+254712345678').replace(/[^0-9+]/g, '').slice(0, 20) || '+254712345678'),
  niche: z
    .string()
    .max(32)
    .optional()
    .transform((val) => {
      const normalized = (val || '').toLowerCase().trim();
      return (SUPPORTED_NICHES as readonly string[]).includes(normalized)
        ? (normalized as (typeof SUPPORTED_NICHES)[number])
        : 'general';
    }),
  exp: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === '') return undefined;
      const num = Number(val);
      return Number.isFinite(num) && num > 0 ? Math.floor(num) : undefined;
    }),
  sig: z
    .string()
    .max(128)
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      const clean = val.trim();
      return /^[0-9a-fA-F]{64}$/.test(clean) ? clean.toLowerCase() : clean;
    }),
});

export const LeadSubmissionSchema = z.object({
  fullName: z
    .string()
    .min(2, 'Full name must be at least 2 characters')
    .max(100)
    .transform((val) => sanitizePlainText(val, 100)),
  phone: z.string().min(8).max(25),
  email: z
    .string()
    .email()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val ? val.trim().toLowerCase() : undefined)),
  serviceRequested: z
    .string()
    .min(2)
    .max(150)
    .transform((val) => sanitizePlainText(val, 150)),
  organizationSlug: z
    .string()
    .min(2)
    .max(100)
    .transform((val) => toTenantSlug(val)),
  ownerPhone: z.string().min(8).max(25).optional(),
  demoContext: z
    .object({
      client: z.string().max(120).optional(),
      color: z.string().max(16).optional(),
      phone: z.string().max(30).optional(),
      niche: z.string().max(32).optional(),
      exp: z.union([z.string(), z.number()]).optional(),
      sig: z.string().max(128).optional(),
    })
    .optional(),
  consentAccepted: z.boolean().refine((val) => val === true, {
    message: 'Consent is required before submitting your contact details.',
  }),
  privacyNoticeVersion: z
    .string()
    .max(32)
    .optional()
    .default('2026-11-odpc-v1')
    .transform((val) => sanitizePlainText(val, 32) || '2026-11-odpc-v1'),
  metadata: z.record(z.unknown()).optional().default({}),
  attribution: z
    .object({
      utm_source: z.string().max(120).nullable().optional(),
      utm_medium: z.string().max(120).nullable().optional(),
      utm_campaign: z.string().max(120).nullable().optional(),
      referrer: z.string().max(500).nullable().optional(),
    })
    .optional()
    .default({}),
});

export const AdminSignDemoSchema = z.object({
  client: z
    .string()
    .min(2)
    .max(80)
    .transform((val) => sanitizePlainText(val, 80)),
  color: z
    .string()
    .optional()
    .default('2563EB')
    .transform((val) => sanitizeHexColor(val)),
  phone: z.string().min(8).max(25),
  niche: NicheKeySchema.optional().default('general'),
  ttlSeconds: z.number().int().min(60).max(60 * 60 * 24 * 30).optional().default(60 * 60 * 24 * 7),
});

export const UuidSchema = z.string().uuid();
