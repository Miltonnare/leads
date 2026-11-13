/**
 * Connection-Pooled Typed Supabase Client Factory
 * Reuses warm singleton instances across serverless invocations and supports Supavisor/PgBouncer URLs.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

let serviceClient: SupabaseClient<Database> | null = null;
let anonClient: SupabaseClient<Database> | null = null;

export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(
    url &&
      serviceKey &&
      !url.includes('demo-chameleon-project') &&
      !serviceKey.includes('dummy-service-role-key')
  );
}

/**
 * Returns a typed Service Role Supabase client using connection-pooled PostgREST HTTP keep-alive.
 * Prefer SUPABASE_POOLER_URL / NEXT_PUBLIC_SUPABASE_URL configured with PgBouncer/Supavisor.
 */
export function getPooledServiceSupabaseClient(): SupabaseClient<Database> {
  if (serviceClient) {
    return serviceClient;
  }

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://demo-chameleon-project.supabase.co';
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-service-role-key-for-build-and-demo';

  serviceClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    db: {
      schema: 'public',
    },
    global: {
      headers: {
        'x-chameleon-client': 'chameleon-engine-server',
        Connection: 'keep-alive',
      },
    },
  });

  return serviceClient;
}

/**
 * Returns a typed public Anon Supabase client for restricted read operations.
 */
export function getPooledPublicSupabaseClient(): SupabaseClient<Database> {
  if (anonClient) {
    return anonClient;
  }

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://demo-chameleon-project.supabase.co';
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy-anon-key-for-build-and-demo';

  anonClient = createClient<Database>(supabaseUrl, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  return anonClient;
}
