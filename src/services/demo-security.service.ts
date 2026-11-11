/**
 * Demo Security & Anti-Abuse Service
 * Handles:
 *   1. HMAC-SHA256 generation and constant-time verification for signed demo URLs
 *   2. Enforcing SANDBOX_SIMULATION on unsigned/expired/tampered demo traffic
 *   3. Sliding-window rate limiting per IP and per destination E.164 phone number
 */

import crypto from 'crypto';
import {
  DemoQueryParamsSchema,
  normalizeNicheKey,
  sanitizeHexColor,
  sanitizePlainText,
  validateAndFormatPhone,
  type DemoContextVerification,
  type NicheKey,
} from '@/core/domain';
import type { RateLimiter } from '@/core/ports';

export interface SignDemoUrlInput {
  client: string;
  color: string;
  phone: string;
  niche: NicheKey;
  ttlSeconds: number;
}

export interface RateLimitCheckOutcome {
  allowed: boolean;
  reason?: 'IP_RATE_LIMIT' | 'PHONE_RATE_LIMIT';
  retryAfterSeconds: number;
}

export class DemoSecurityService {
  private readonly ipLimitPerMinute: number;
  private readonly phoneLimitPerTenMinutes: number;

  constructor(private readonly rateLimiter: RateLimiter) {
    this.ipLimitPerMinute = Number(process.env.RATE_LIMIT_IP_PER_MINUTE || 12);
    this.phoneLimitPerTenMinutes = Number(process.env.RATE_LIMIT_PHONE_PER_10M || 5);
  }

  /**
   * Computes canonical HMAC-SHA256 signature over client + color + phone + niche + exp.
   */
  signDemoParams(input: {
    client: string;
    color: string;
    phone: string;
    niche: NicheKey;
    exp: number;
  }): string {
    const secret = this.getSigningSecret();
    if (!secret) {
      throw new Error('DEMO_SIGNING_SECRET is not configured on the server');
    }

    const canonical = this.buildCanonicalString(input);
    return crypto.createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
  }

  /**
   * Generates a complete signed demo URL query string & full URL for admin sharing.
   */
  mintSignedDemoUrl(
    baseUrl: string,
    input: SignDemoUrlInput
  ): { url: string; exp: number; sig: string; normalizedPhone: string } {
    const cleanClient = sanitizePlainText(input.client, 80);
    const cleanColor = sanitizeHexColor(input.color, '2563EB');
    const cleanNiche = normalizeNicheKey(input.niche);
    const phoneResult = validateAndFormatPhone(input.phone);
    const cleanPhone = phoneResult.isValid
      ? phoneResult.e164
      : input.phone.replace(/[^0-9+]/g, '');

    const exp = Math.floor(Date.now() / 1000) + input.ttlSeconds;
    const sig = this.signDemoParams({
      client: cleanClient,
      color: cleanColor,
      phone: cleanPhone,
      niche: cleanNiche,
      exp,
    });

    const query = new URLSearchParams({
      client: cleanClient,
      color: cleanColor,
      phone: cleanPhone,
      niche: cleanNiche,
      exp: String(exp),
      sig,
    });

    const cleanBase = baseUrl.replace(/\/$/, '');
    return {
      url: `${cleanBase}/?${query.toString()}`,
      exp,
      sig,
      normalizedPhone: cleanPhone,
    };
  }

  /**
   * Validates and sanitizes query parameters, then verifies HMAC signature & expiry.
   * Unsigned or invalid links strictly run in SANDBOX_SIMULATION mode.
   */
  verifyDemoContext(rawParams: Record<string, unknown>): DemoContextVerification {
    const safeResult = DemoQueryParamsSchema.safeParse(rawParams);
    const parsed = safeResult.success
      ? safeResult.data
      : DemoQueryParamsSchema.parse({});
    const phoneValidation = validateAndFormatPhone(parsed.phone);
    const cleanPhone = phoneValidation.isValid ? phoneValidation.e164 : parsed.phone;

    const sanitizedParams = {
      client: parsed.client,
      color: parsed.color,
      phone: cleanPhone,
      niche: parsed.niche,
      exp: parsed.exp,
      sig: parsed.sig,
    };

    if (!parsed.sig || !parsed.exp) {
      return {
        isSignedLive: false,
        executionMode: 'SANDBOX_SIMULATION',
        reason: 'UNSIGNED_DEMO',
        sanitizedParams,
      };
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (parsed.exp < nowSeconds) {
      return {
        isSignedLive: false,
        executionMode: 'SANDBOX_SIMULATION',
        reason: 'EXPIRED_SIGNATURE',
        sanitizedParams,
      };
    }

    const secret = this.getSigningSecret();
    if (!secret) {
      return {
        isSignedLive: false,
        executionMode: 'SANDBOX_SIMULATION',
        reason: 'INVALID_SIGNATURE',
        sanitizedParams,
      };
    }

    const expectedHex = crypto
      .createHmac('sha256', secret)
      .update(
        this.buildCanonicalString({
          client: sanitizedParams.client,
          color: sanitizedParams.color,
          phone: sanitizedParams.phone,
          niche: sanitizedParams.niche,
          exp: parsed.exp,
        }),
        'utf8'
      )
      .digest('hex');

    const providedBuf = Buffer.from(parsed.sig, 'utf8');
    const expectedBuf = Buffer.from(expectedHex, 'utf8');

    const isMatch =
      providedBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(providedBuf, expectedBuf);

    if (!isMatch) {
      return {
        isSignedLive: false,
        executionMode: 'SANDBOX_SIMULATION',
        reason: 'INVALID_SIGNATURE',
        sanitizedParams,
      };
    }

    return {
      isSignedLive: true,
      executionMode: 'LIVE_DISPATCH',
      reason: 'VALID_SIGNATURE',
      sanitizedParams,
    };
  }

  /**
   * Sliding-window rate limit check executed before any DB write or external telecom dispatch.
   */
  async enforceSubmissionRateLimits(
    ipAddress: string,
    phoneE164: string
  ): Promise<RateLimitCheckOutcome> {
    const cleanIp = ipAddress.split(',')[0]?.trim() || '127.0.0.1';

    const ipResult = await this.rateLimiter.checkAndConsume(
      `ip:${cleanIp}`,
      this.ipLimitPerMinute,
      60
    );

    if (!ipResult.allowed) {
      return {
        allowed: false,
        reason: 'IP_RATE_LIMIT',
        retryAfterSeconds: ipResult.retryAfterSeconds,
      };
    }

    const phoneResult = await this.rateLimiter.checkAndConsume(
      `phone:${phoneE164}`,
      this.phoneLimitPerTenMinutes,
      600
    );

    if (!phoneResult.allowed) {
      return {
        allowed: false,
        reason: 'PHONE_RATE_LIMIT',
        retryAfterSeconds: phoneResult.retryAfterSeconds,
      };
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }

  private getSigningSecret(): string | null {
    return process.env.DEMO_SIGNING_SECRET?.trim() || null;
  }

  private buildCanonicalString(input: {
    client: string;
    color: string;
    phone: string;
    niche: NicheKey;
    exp: number;
  }): string {
    return [
      `client=${encodeURIComponent(input.client)}`,
      `color=${encodeURIComponent(input.color)}`,
      `phone=${encodeURIComponent(input.phone)}`,
      `niche=${encodeURIComponent(input.niche)}`,
      `exp=${input.exp}`,
    ].join('&');
  }
}
