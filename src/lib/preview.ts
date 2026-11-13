import { DemoQueryParamsSchema } from '@/core/domain';
import { getAppServices } from './container';

export type PreviewQuery = Record<string, string | string[] | undefined>;

export function resolvePreview(query: PreviewQuery = {}) {
  const context = getAppServices().demoSecurityService.verifyDemoContext(query);
  return context.isSignedLive ? context.sanitizedParams : DemoQueryParamsSchema.parse({});
}
