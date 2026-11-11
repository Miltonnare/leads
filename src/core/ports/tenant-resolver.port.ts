/**
 * Tenant Resolver Port
 * Resolves multi-tenant configuration by slug or WhatsApp Cloud API phone_number_id.
 */

import type { TenantConfig } from '../domain';

export interface TenantResolver {
  resolveBySlug(slug: string): Promise<TenantConfig | null>;
  resolveByWhatsAppPhoneNumberId(phoneNumberId: string): Promise<TenantConfig | null>;
}
