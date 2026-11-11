/**
 * E.164 Phone Number Normalization & Validation Utility
 * Supports Kenyan local shorthand (07XX, 01XX, 2547XX, 7XX), +254, and international E.164.
 */

import { parsePhoneNumber, isValidPhoneNumber, CountryCode } from 'libphonenumber-js';
import type { CarrierType, ValidatedPhone } from './types';

const INVALID_PHONE: ValidatedPhone = {
  isValid: false,
  e164: '',
  countryCode: '',
  formattedInternational: '',
  formattedNational: '',
};

/**
 * Normalizes and validates any input phone string into strict E.164 format.
 * Automatically resolves Kenyan local format (e.g. 0712345678, 0112345678) to +254712345678.
 */
export function validateAndFormatPhone(
  rawPhone: string,
  defaultCountry: CountryCode = 'KE'
): ValidatedPhone {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return INVALID_PHONE;
  }

  let sanitized = rawPhone.replace(/[\s\-\(\)\.]/g, '').trim();

  // Kenyan shorthand normalization:
  // '07XXXXXXXX' or '01XXXXXXXX' (10 digits) -> '+2547XXXXXXXX' or '+2541XXXXXXXX'
  if (/^0[17]\d{8}$/.test(sanitized)) {
    sanitized = `+254${sanitized.substring(1)}`;
  }
  // '2547XXXXXXXX' or '2541XXXXXXXX' (12 digits) -> '+2547XXXXXXXX'
  else if (/^254[17]\d{8}$/.test(sanitized)) {
    sanitized = `+${sanitized}`;
  }
  // '7XXXXXXXX' or '1XXXXXXXX' (9 digits) -> '+2547XXXXXXXX'
  else if (/^[17]\d{8}$/.test(sanitized)) {
    sanitized = `+254${sanitized}`;
  }

  try {
    const isE164 = sanitized.startsWith('+');
    const valid = isE164
      ? isValidPhoneNumber(sanitized)
      : isValidPhoneNumber(sanitized, defaultCountry);

    if (!valid) {
      return INVALID_PHONE;
    }

    const parsed = isE164
      ? parsePhoneNumber(sanitized)
      : parsePhoneNumber(sanitized, defaultCountry);

    if (!parsed || !parsed.isValid()) {
      return INVALID_PHONE;
    }

    let carrierType: CarrierType = 'other';
    const nationalNumber = parsed.nationalNumber;
    if (parsed.country === 'KE') {
      if (
        /^7(0[0-9]|1[0-9]|2[0-9]|4[0-3]|4[5-8]|5[7-9]|6[8-9]|9[0-9])/.test(nationalNumber) ||
        /^1(1[0-5])/.test(nationalNumber)
      ) {
        carrierType = 'safaricom';
      } else if (
        /^7(3[0-9]|5[0-6]|8[0-9])/.test(nationalNumber) ||
        /^1(0[0-2])/.test(nationalNumber)
      ) {
        carrierType = 'airtel';
      } else if (/^77[0-9]/.test(nationalNumber)) {
        carrierType = 'telkom';
      }
    }

    return {
      isValid: true,
      e164: parsed.number,
      countryCode: parsed.country || defaultCountry,
      formattedInternational: parsed.formatInternational(),
      formattedNational: parsed.formatNational(),
      carrierType,
    };
  } catch {
    return INVALID_PHONE;
  }
}
