/**
 * Pure GSM-7 SMS Cost Optimizer, Opt-Out Detector & Compact UUID Codec
 * Zero external dependencies.
 * Prevents Africa's Talking UCS-2 Unicode downgrade (70-char vs 160-char billing)
 * and compresses 36-char UUIDs into 22-char base64url tokens for 1-tap SMS alerts.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPACT_UUID_RE = /^[A-Za-z0-9_-]{22}$/;
const B64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const GSM7_BASIC_AND_EXT_ALLOWED =
  /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;

/**
 * Normalizes smart punctuation and strips non-GSM-7 Unicode characters
 * so SMS gateways keep standard 160-character GSM-7 segmentation.
 */
export function sanitizeToGsm7(input: string, maxLength?: number): string {
  const normalized = input
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x20-\x7E\n\r£¥èéùìòÇØøÅåΔΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

  if (typeof maxLength === 'number' && normalized.length > maxLength) {
    return normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd() + '...';
  }
  return normalized;
}

export function isStrictlyGsm7(input: string): boolean {
  return GSM7_BASIC_AND_EXT_ALLOWED.test(input);
}

/**
 * Detects standard SMS/WhatsApp opt-out keywords for ODPC & CAK compliance.
 */
export function isOptOutKeyword(text: string): boolean {
  const clean = text.trim().toUpperCase().replace(/[^A-Z0-9\s]/g, '');
  return (
    clean === 'STOP' ||
    clean === 'STOP ALL' ||
    clean === 'UNSUBSCRIBE' ||
    clean === 'OPTOUT' ||
    clean === 'OPT OUT' ||
    clean === 'CANCEL' ||
    clean === 'QUIT'
  );
}

/**
 * Encodes a 36-char UUID into a 22-char URL-safe base64url token (16 bytes -> 22 chars).
 */
export function encodeCompactUuid(uuid: string): string {
  if (!UUID_RE.test(uuid)) return uuid;

  const hex = uuid.replace(/-/g, '').toLowerCase();
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  let out = '';
  for (let i = 0; i < 16; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < 16 ? bytes[i + 1] : 0;
    const b2 = i + 2 < 16 ? bytes[i + 2] : 0;

    out += B64URL_ALPHABET[b0 >> 2];
    out += B64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (i + 1 < 16) {
      out += B64URL_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    }
    if (i + 2 < 16) {
      out += B64URL_ALPHABET[b2 & 0x3f];
    }
  }
  return out;
}

/**
 * Accepts either a standard 36-char UUID or a 22-char compact UUID token.
 */
export function decodeLeadIdentifier(rawId: string): string | null {
  const trimmed = rawId.trim();
  if (UUID_RE.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  if (!COMPACT_UUID_RE.test(trimmed)) {
    return null;
  }

  const values: number[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    const idx = B64URL_ALPHABET.indexOf(trimmed[i]);
    if (idx === -1) return null;
    values.push(idx);
  }

  const bytes = new Uint8Array(16);
  let byteIdx = 0;
  for (let i = 0; i < values.length; i += 4) {
    const c0 = values[i];
    const c1 = values[i + 1] ?? 0;
    const c2 = values[i + 2] ?? 0;
    const c3 = values[i + 3] ?? 0;

    if (byteIdx < 16) bytes[byteIdx++] = (c0 << 2) | (c1 >> 4);
    if (i + 2 < values.length && byteIdx < 16) bytes[byteIdx++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (i + 3 < values.length && byteIdx < 16) bytes[byteIdx++] = ((c2 & 0x03) << 6) | c3;
  }

  let hex = '';
  for (let i = 0; i < 16; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Formats a strictly transactional Customer SMS capped at <= 160 GSM-7 chars (1 billed SMS unit).
 */
export function formatCompactCustomerSms(params: {
  customerName: string;
  clientName: string;
  serviceRequested: string;
}): string {
  const firstName = sanitizeToGsm7(params.customerName.split(/\s+/)[0] || 'Customer', 20);
  const client = sanitizeToGsm7(params.clientName, 28);
  const prefix = `${client}: Hi ${firstName}, we received your request for "`;
  const suffix = `". A specialist will call shortly. Reply STOP to opt out.`;

  const remainingForService = Math.max(12, 160 - prefix.length - suffix.length);
  const service = sanitizeToGsm7(params.serviceRequested, remainingForService);

  const full = `${prefix}${service}${suffix}`;
  return full.length <= 160 ? full : sanitizeToGsm7(full, 160);
}

/**
 * Formats a compact GSM-7 Owner 1-Tap Dialer Alert with shortened /r/c/ & /r/w/ SLA links.
 */
export function formatCompactOwnerAlertSms(params: {
  leadId: string;
  clientName: string;
  customerName: string;
  customerPhoneE164: string;
  serviceRequested: string;
  appBaseUrl: string;
}): string {
  const shortId = encodeCompactUuid(params.leadId);
  const cleanBase = params.appBaseUrl.replace(/\/$/, '');
  const callUrl = `${cleanBase}/r/c/${shortId}`;
  const waUrl = `${cleanBase}/r/w/${shortId}`;

  const client = sanitizeToGsm7(params.clientName, 24);
  const customer = sanitizeToGsm7(params.customerName, 26);
  const service = sanitizeToGsm7(params.serviceRequested, 42);

  return (
    `[LEAD - ${client}]\n` +
    `${customer} (${params.customerPhoneE164})\n` +
    `Req: ${service}\n` +
    `Call: ${callUrl}\n` +
    `WA: ${waUrl}`
  );
}

/**
 * Formats an urgent SLA Escalation reminder when the owner has not tapped within 5 minutes.
 */
export function formatSlaEscalationSms(params: {
  leadId: string;
  clientName: string;
  customerName: string;
  customerPhoneE164: string;
  appBaseUrl: string;
}): string {
  const shortId = encodeCompactUuid(params.leadId);
  const cleanBase = params.appBaseUrl.replace(/\/$/, '');
  const callUrl = `${cleanBase}/r/c/${shortId}`;

  const client = sanitizeToGsm7(params.clientName, 22);
  const customer = sanitizeToGsm7(params.customerName, 24);

  return (
    `[SLA ALERT - ${client}] Unclaimed lead >5m: ${customer} (${params.customerPhoneE164}). ` +
    `Tap to call: ${callUrl}`
  );
}
