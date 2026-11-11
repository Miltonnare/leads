/**
 * Server Composition Root (Dependency Injection Container)
 * Wires adapters into application services for thin Next.js route handlers.
 */

import { getPooledServiceSupabaseClient } from '@/adapters/database/supabase-client';
import { SupabaseLeadRepository } from '@/adapters/database/supabase-lead.repository';
import { AfricasTalkingAdapter } from '@/adapters/providers/africas-talking.adapter';
import { MetaWhatsAppAdapter } from '@/adapters/providers/meta-whatsapp.adapter';
import { SlidingWindowRateLimiter } from '@/adapters/security/sliding-window-rate-limiter';
import { DemoSecurityService } from '@/services/demo-security.service';
import { LeadDispatchService } from '@/services/lead-dispatch.service';
import { WebhookProcessorService } from '@/services/webhook-processor.service';

export interface AppServices {
  repository: SupabaseLeadRepository;
  demoSecurityService: DemoSecurityService;
  leadDispatchService: LeadDispatchService;
  webhookProcessorService: WebhookProcessorService;
}

let cachedServices: AppServices | null = null;

export function getAppServices(): AppServices {
  if (cachedServices) {
    return cachedServices;
  }

  const supabase = getPooledServiceSupabaseClient();
  const repository = new SupabaseLeadRepository(supabase);
  const rateLimiter = new SlidingWindowRateLimiter(supabase);
  const demoSecurityService = new DemoSecurityService(rateLimiter);
  const whatsappProvider = new MetaWhatsAppAdapter();
  const smsProvider = new AfricasTalkingAdapter();

  const leadDispatchService = new LeadDispatchService(
    repository,
    demoSecurityService,
    whatsappProvider,
    smsProvider
  );

  const webhookProcessorService = new WebhookProcessorService(repository, repository);

  cachedServices = {
    repository,
    demoSecurityService,
    leadDispatchService,
    webhookProcessorService,
  };

  return cachedServices;
}
