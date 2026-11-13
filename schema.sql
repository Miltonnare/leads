-- ============================================================================
-- CHAMELEON LEAD & QUOTE RECOVERY ENGINE - PRODUCTION POSTGRESQL MIGRATION
-- Target: Supabase (PostgreSQL 15+)
-- Highlights:
--   1. Multi-tenant WABA + Africa's Talking credentials & DISPATCH_MODE config
--   2. Atomic single-roundtrip lead ingestion & sliding-window dedup RPC
--      (pg_advisory_xact_lock prevents concurrent check-then-insert races)
--   3. Idempotent webhook_events ledger keyed by (provider, provider_message_id, status)
--   4. Monotonic state machine trigger preventing out-of-order status downgrades
--   5. Distributed sliding-window rate limiter table + RPC
--   6. Owner 1-tap SLA click-tracking columns & atomic tracking RPC
-- ============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. ENUMS FOR TYPE SAFETY
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE lead_status_enum AS ENUM (
        'PENDING',
        'NEW',
        'DEDUPLICATED',
        'DISPATCHED_TO_OWNER',
        'SENT',
        'WHATSAPP_SENT',
        'DELIVERED',
        'CUSTOMER_REPLIED',
        'ENGAGED',
        'CONVERTED',
        'LOST',
        'EXPIRED_NO_RESPONSE'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Ensure enum values exist when migrating from prototype schema
ALTER TYPE lead_status_enum ADD VALUE IF NOT EXISTS 'PENDING' BEFORE 'NEW';
ALTER TYPE lead_status_enum ADD VALUE IF NOT EXISTS 'SENT' AFTER 'DISPATCHED_TO_OWNER';

DO $$ BEGIN
    CREATE TYPE dispatch_mode_enum AS ENUM (
        'PARALLEL_DEMO',
        'WATERFALL_PROD'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE execution_mode_enum AS ENUM (
        'LIVE_DISPATCH',
        'SANDBOX_SIMULATION'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE dispatch_channel_enum AS ENUM (
        'WHATSAPP_CLOUD_API',
        'AFRICAS_TALKING_SMS',
        'OWNER_DIALER_ALERT',
        'SYSTEM_WEBHOOK'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE dispatch_status_enum AS ENUM (
        'PENDING',
        'SUCCESS',
        'FAILED',
        'FALLBACK_TRIGGERED',
        'SIMULATED'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE dispatch_status_enum ADD VALUE IF NOT EXISTS 'SIMULATED';
-- PostgreSQL requires new enum labels to commit before first use.
COMMIT;
BEGIN;

DO $$ BEGIN
    CREATE TYPE webhook_provider_enum AS ENUM (
        'META_WHATSAPP',
        'AFRICAS_TALKING'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 2. ORGANIZATIONS (MULTI-TENANT REGISTRY, CREDENTIALS & DISPATCH STRATEGY)
-- ============================================================================
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug CITEXT UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    niche VARCHAR(64) NOT NULL DEFAULT 'general',
    contact_phone VARCHAR(32) NOT NULL,
    owner_dialer_phone VARCHAR(32) NOT NULL,
    dispatch_mode dispatch_mode_enum NOT NULL DEFAULT 'PARALLEL_DEMO',
    whatsapp_phone_number_id VARCHAR(64) DEFAULT NULL,
    whatsapp_access_token_encrypted TEXT DEFAULT NULL,
    at_sender_id VARCHAR(32) DEFAULT NULL,
    primary_color VARCHAR(7) NOT NULL DEFAULT '#2563EB',
    is_active BOOLEAN NOT NULL DEFAULT true,
    settings JSONB NOT NULL DEFAULT '{
        "auto_dispatch_whatsapp": true,
        "auto_dispatch_sms": true,
        "dedup_window_minutes": 10,
        "waterfall_sms_delay_ms": 15000,
        "working_hours_only": false
    }'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent column upgrades for existing prototype databases
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS dispatch_mode dispatch_mode_enum NOT NULL DEFAULT 'PARALLEL_DEMO';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS whatsapp_access_token_encrypted TEXT DEFAULT NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS at_sender_id VARCHAR(32) DEFAULT NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_wa_phone_id ON organizations(whatsapp_phone_number_id)
    WHERE whatsapp_phone_number_id IS NOT NULL;

-- ============================================================================
-- 3. LEADS (CORE INTAKE, ATTRIBUTION & SLA TELEMETRY)
-- ============================================================================
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    raw_name VARCHAR(255) NOT NULL,
    phone_e164 VARCHAR(32) NOT NULL,
    email CITEXT,
    service_requested VARCHAR(128) NOT NULL,
    estimated_value_kes NUMERIC(12, 2) DEFAULT 0.00,
    status lead_status_enum NOT NULL DEFAULT 'PENDING',
    execution_mode execution_mode_enum NOT NULL DEFAULT 'LIVE_DISPATCH',
    first_response_latency_ms INTEGER DEFAULT NULL,
    db_latency_ms INTEGER DEFAULT NULL,
    owner_call_initiated_at TIMESTAMPTZ DEFAULT NULL,
    owner_clicked_call_at TIMESTAMPTZ DEFAULT NULL,
    owner_clicked_wa_at TIMESTAMPTZ DEFAULT NULL,
    sla_escalated_at TIMESTAMPTZ DEFAULT NULL,
    customer_replied_at TIMESTAMPTZ DEFAULT NULL,
    consent_accepted BOOLEAN NOT NULL DEFAULT false,
    consent_accepted_at TIMESTAMPTZ DEFAULT NULL,
    privacy_notice_version VARCHAR(32) NOT NULL DEFAULT '2026-11-odpc-v1',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    attribution JSONB NOT NULL DEFAULT '{
        "utm_source": null,
        "utm_medium": null,
        "utm_campaign": null,
        "referrer": null,
        "ip_address": null,
        "user_agent": null
    }'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE leads ADD COLUMN IF NOT EXISTS execution_mode execution_mode_enum NOT NULL DEFAULT 'LIVE_DISPATCH';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS db_latency_ms INTEGER DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner_clicked_call_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner_clicked_wa_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sla_escalated_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_accepted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_accepted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS privacy_notice_version VARCHAR(32) NOT NULL DEFAULT '2026-11-odpc-v1';

CREATE INDEX IF NOT EXISTS idx_leads_org_created ON leads(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone_e164);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_metadata_gin ON leads USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_leads_attribution_gin ON leads USING GIN(attribution);
CREATE INDEX IF NOT EXISTS idx_leads_dedup ON leads(organization_id, phone_e164, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_sla_pending ON leads(created_at ASC)
    WHERE execution_mode = 'LIVE_DISPATCH'
      AND owner_clicked_call_at IS NULL
      AND owner_clicked_wa_at IS NULL
      AND customer_replied_at IS NULL;

-- ============================================================================
-- 3B. DND / OPT-OUT REGISTRY (ODPC & CAK STOP SUPPRESSION)
-- ============================================================================
CREATE TABLE IF NOT EXISTS phone_opt_outs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_e164 VARCHAR(32) NOT NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    source VARCHAR(32) NOT NULL DEFAULT 'inbound_stop',
    reason TEXT DEFAULT NULL,
    opted_out_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_phone_opt_outs_scope
    ON phone_opt_outs (phone_e164, COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_phone_opt_outs_phone ON phone_opt_outs(phone_e164);

-- ============================================================================
-- 4. CONVERSATIONS (TWO-WAY AUDIT TRAIL)
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    channel VARCHAR(32) NOT NULL,
    direction VARCHAR(16) NOT NULL,
    external_message_id VARCHAR(128),
    message_body TEXT NOT NULL,
    delivery_status VARCHAR(32) NOT NULL DEFAULT 'SENT',
    raw_payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_lead ON conversations(lead_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_conversations_external_id ON conversations(external_message_id)
    WHERE external_message_id IS NOT NULL;

-- ============================================================================
-- 5. LEAD DISPATCHES (CARRIER & TELECOM AUDIT LOG)
-- ============================================================================
CREATE TABLE IF NOT EXISTS lead_dispatches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    channel dispatch_channel_enum NOT NULL,
    destination VARCHAR(64) NOT NULL,
    provider_message_id VARCHAR(128) DEFAULT NULL,
    status dispatch_status_enum NOT NULL DEFAULT 'PENDING',
    latency_ms INTEGER DEFAULT NULL,
    request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    response_payload JSONB DEFAULT '{}'::jsonb,
    error_message TEXT DEFAULT NULL,
    dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ DEFAULT NULL
);

ALTER TABLE lead_dispatches ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(128) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_dispatches_lead ON lead_dispatches(lead_id, dispatched_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatches_status ON lead_dispatches(status);
CREATE INDEX IF NOT EXISTS idx_dispatches_provider_msg_id ON lead_dispatches(provider_message_id)
    WHERE provider_message_id IS NOT NULL;

-- ============================================================================
-- 6. IDEMPOTENT WEBHOOK LEDGER
-- ============================================================================
CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider webhook_provider_enum NOT NULL,
    provider_message_id VARCHAR(128) NOT NULL,
    status VARCHAR(64) NOT NULL,
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_webhook_events_idempotency UNIQUE (provider, provider_message_id, status)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_lead ON webhook_events(lead_id, processed_at DESC);

-- ============================================================================
-- 7. DISTRIBUTED SLIDING-WINDOW RATE LIMITS
-- ============================================================================
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    bucket_key VARCHAR(255) NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1,
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_expires ON rate_limit_buckets(expires_at);

-- ============================================================================
-- 8. AUDIT LOGS (SECURITY, ACCESS & SLA TRACKING)
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL,
    actor_type VARCHAR(32) NOT NULL,
    actor_id VARCHAR(64) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address INET DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created ON audit_logs(organization_id, created_at DESC);

-- ============================================================================
-- 9. TRIGGERS: UPDATED_AT & MONOTONIC STATE MACHINE GUARD
-- ============================================================================
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_organizations_timestamp ON organizations;
CREATE TRIGGER set_organizations_timestamp
BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_leads_timestamp ON leads;
CREATE TRIGGER set_leads_timestamp
BEFORE UPDATE ON leads
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- Rank helper for monotonic lead progression:
-- PENDING/NEW (10) -> DISPATCHED_TO_OWNER (20) -> SENT/WHATSAPP_SENT (30)
-- -> DELIVERED (40) -> CUSTOMER_REPLIED (50) -> ENGAGED (60) -> Terminal (70)
CREATE OR REPLACE FUNCTION lead_status_rank(s lead_status_enum)
RETURNS INTEGER AS $$
BEGIN
    CASE s
        WHEN 'PENDING' THEN RETURN 10;
        WHEN 'NEW' THEN RETURN 10;
        WHEN 'DEDUPLICATED' THEN RETURN 15;
        WHEN 'DISPATCHED_TO_OWNER' THEN RETURN 20;
        WHEN 'SENT' THEN RETURN 30;
        WHEN 'WHATSAPP_SENT' THEN RETURN 30;
        WHEN 'DELIVERED' THEN RETURN 40;
        WHEN 'CUSTOMER_REPLIED' THEN RETURN 50;
        WHEN 'ENGAGED' THEN RETURN 60;
        WHEN 'CONVERTED' THEN RETURN 70;
        WHEN 'LOST' THEN RETURN 70;
        WHEN 'EXPIRED_NO_RESPONSE' THEN RETURN 70;
        ELSE RETURN 0;
    END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Prevent out-of-order webhooks (e.g., delayed SENT after DELIVERED or CUSTOMER_REPLIED)
-- from ever downgrading a lead's status.
CREATE OR REPLACE FUNCTION enforce_lead_status_progression()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF lead_status_rank(NEW.status) < lead_status_rank(OLD.status) THEN
            NEW.status := OLD.status;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_leads_status_progression ON leads;
CREATE TRIGGER guard_leads_status_progression
BEFORE UPDATE OF status ON leads
FOR EACH ROW EXECUTE PROCEDURE enforce_lead_status_progression();

-- Conversation delivery status rank helper (SENT -> DELIVERED -> READ / RECEIVED)
CREATE OR REPLACE FUNCTION conversation_delivery_rank(s VARCHAR)
RETURNS INTEGER AS $$
BEGIN
    CASE UPPER(COALESCE(s, ''))
        WHEN 'PENDING' THEN RETURN 10;
        WHEN 'SENT' THEN RETURN 20;
        WHEN 'BUFFERED' THEN RETURN 25;
        WHEN 'FAILED' THEN RETURN 25;
        WHEN 'REJECTED' THEN RETURN 25;
        WHEN 'SUCCESS' THEN RETURN 40;
        WHEN 'DELIVERED' THEN RETURN 40;
        WHEN 'READ' THEN RETURN 50;
        WHEN 'RECEIVED' THEN RETURN 60;
        ELSE RETURN 0;
    END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION enforce_conversation_delivery_progression()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN
        IF conversation_delivery_rank(NEW.delivery_status) < conversation_delivery_rank(OLD.delivery_status) THEN
            NEW.delivery_status := OLD.delivery_status;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_conversations_delivery_progression ON conversations;
CREATE TRIGGER guard_conversations_delivery_progression
BEFORE UPDATE OF delivery_status ON conversations
FOR EACH ROW EXECUTE PROCEDURE enforce_conversation_delivery_progression();

-- ============================================================================
-- 10. ATOMIC SINGLE-ROUNDTRIP RPCs
-- ============================================================================

-- 10A. Atomic Lead Ingestion, Tenant Resolution & Sliding-Window Dedup
DROP FUNCTION IF EXISTS ingest_lead_atomic(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, NUMERIC, execution_mode_enum, JSONB, JSONB);

CREATE OR REPLACE FUNCTION ingest_lead_atomic(
    p_org_slug TEXT,
    p_org_name TEXT,
    p_niche TEXT,
    p_primary_color TEXT,
    p_owner_phone TEXT,
    p_allow_auto_register BOOLEAN,
    p_raw_name TEXT,
    p_phone_e164 TEXT,
    p_email TEXT,
    p_service_requested TEXT,
    p_estimated_value_kes NUMERIC,
    p_execution_mode execution_mode_enum,
    p_metadata JSONB,
    p_attribution JSONB,
    p_consent_accepted BOOLEAN DEFAULT false,
    p_privacy_notice_version TEXT DEFAULT '2026-11-odpc-v1'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org RECORD;
    v_existing_lead RECORD;
    v_new_lead_id UUID;
    v_dedup_minutes INTEGER;
    v_dedup_cutoff TIMESTAMPTZ;
    v_lock_key BIGINT;
    v_effective_owner_phone TEXT;
    v_is_opted_out BOOLEAN := false;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    -- Serialize concurrent requests for the exact same (tenant, phone_e164) pair.
    -- Uses transaction-scoped pg_advisory_xact_lock (safe under Supavisor transaction pooling;
    -- never use session-level pg_advisory_lock across pooled connections).
    v_lock_key := hashtextextended(LOWER(TRIM(p_org_slug)) || ':' || TRIM(p_phone_e164), 0);
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- 1. Resolve existing organization
    SELECT
        id,
        slug,
        name,
        niche,
        contact_phone,
        owner_dialer_phone,
        dispatch_mode,
        whatsapp_phone_number_id,
        whatsapp_access_token_encrypted,
        at_sender_id,
        primary_color,
        settings
    INTO v_org
    FROM organizations
    WHERE slug = p_org_slug
      AND is_active = true
    LIMIT 1;

    -- 2. Auto-register demo organization if allowed and not found
    IF v_org.id IS NULL THEN
        IF NOT p_allow_auto_register THEN
            RAISE EXCEPTION 'TENANT_NOT_FOUND: Organization "%" does not exist', p_org_slug
                USING ERRCODE = 'P0002';
        END IF;

        v_effective_owner_phone := COALESCE(NULLIF(TRIM(p_owner_phone), ''), p_phone_e164);

        INSERT INTO organizations (
            slug,
            name,
            niche,
            contact_phone,
            owner_dialer_phone,
            primary_color,
            dispatch_mode
        )
        VALUES (
            LOWER(TRIM(p_org_slug)),
            COALESCE(NULLIF(TRIM(p_org_name), ''), INITCAP(REPLACE(p_org_slug, '-', ' '))),
            COALESCE(NULLIF(TRIM(p_niche), ''), 'general'),
            v_effective_owner_phone,
            v_effective_owner_phone,
            COALESCE(NULLIF(TRIM(p_primary_color), ''), '#2563EB'),
            'PARALLEL_DEMO'
        )
        ON CONFLICT (slug) DO UPDATE
            SET updated_at = NOW()
        RETURNING
            id,
            slug,
            name,
            niche,
            contact_phone,
            owner_dialer_phone,
            dispatch_mode,
            whatsapp_phone_number_id,
            whatsapp_access_token_encrypted,
            at_sender_id,
            primary_color,
            settings
        INTO v_org;
    END IF;

    -- 3. Check sliding-window deduplication (default 10 minutes)
    v_dedup_minutes := GREATEST(1, COALESCE((v_org.settings->>'dedup_window_minutes')::INTEGER, 10));
    v_dedup_cutoff := NOW() - MAKE_INTERVAL(mins => v_dedup_minutes);

    SELECT id, status, created_at
    INTO v_existing_lead
    FROM leads
    WHERE organization_id = v_org.id
      AND phone_e164 = p_phone_e164
      AND execution_mode = p_execution_mode
      AND created_at > v_dedup_cutoff
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing_lead.id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'lead_id', v_existing_lead.id,
            'is_duplicate', true,
            'is_opted_out', false,
            'existing_status', v_existing_lead.status,
            'tenant_config', jsonb_build_object(
                'id', v_org.id,
                'slug', v_org.slug,
                'name', v_org.name,
                'niche', v_org.niche,
                'owner_dialer_phone', COALESCE(NULLIF(TRIM(p_owner_phone), ''), v_org.owner_dialer_phone),
                'dispatch_mode', v_org.dispatch_mode,
                'whatsapp_phone_number_id', v_org.whatsapp_phone_number_id,
                'whatsapp_access_token_encrypted', v_org.whatsapp_access_token_encrypted,
                'at_sender_id', v_org.at_sender_id,
                'primary_color', v_org.primary_color,
                'settings', v_org.settings
            )
        );
    END IF;

    -- 3B. Check ODPC / DND opt-out suppression registry
    SELECT EXISTS (
        SELECT 1
        FROM phone_opt_outs
        WHERE phone_e164 = p_phone_e164
          AND (organization_id IS NULL OR organization_id = v_org.id)
    ) INTO v_is_opted_out;

    -- 4. Insert new lead atomically with ODPC consent audit trail
    INSERT INTO leads (
        organization_id,
        raw_name,
        phone_e164,
        email,
        service_requested,
        estimated_value_kes,
        status,
        execution_mode,
        consent_accepted,
        consent_accepted_at,
        privacy_notice_version,
        metadata,
        attribution
    )
    VALUES (
        v_org.id,
        p_raw_name,
        p_phone_e164,
        NULLIF(TRIM(p_email), ''),
        p_service_requested,
        COALESCE(p_estimated_value_kes, 0.00),
        'PENDING',
        p_execution_mode,
        COALESCE(p_consent_accepted, false),
        CASE WHEN COALESCE(p_consent_accepted, false) THEN v_now ELSE NULL END,
        COALESCE(NULLIF(TRIM(p_privacy_notice_version), ''), '2026-11-odpc-v1'),
        COALESCE(p_metadata, '{}'::jsonb),
        COALESCE(p_attribution, '{}'::jsonb)
    )
    RETURNING id INTO v_new_lead_id;

    RETURN jsonb_build_object(
        'lead_id', v_new_lead_id,
        'is_duplicate', false,
        'is_opted_out', v_is_opted_out,
        'existing_status', NULL,
        'tenant_config', jsonb_build_object(
            'id', v_org.id,
            'slug', v_org.slug,
            'name', v_org.name,
            'niche', v_org.niche,
            'owner_dialer_phone', COALESCE(NULLIF(TRIM(p_owner_phone), ''), v_org.owner_dialer_phone),
            'dispatch_mode', v_org.dispatch_mode,
            'whatsapp_phone_number_id', v_org.whatsapp_phone_number_id,
            'whatsapp_access_token_encrypted', v_org.whatsapp_access_token_encrypted,
            'at_sender_id', v_org.at_sender_id,
            'primary_color', v_org.primary_color,
            'settings', v_org.settings
        )
    );
END;
$$;

-- 10B. Idempotent Webhook Status Update RPC
CREATE OR REPLACE FUNCTION apply_webhook_event_atomic(
    p_provider webhook_provider_enum,
    p_provider_message_id TEXT,
    p_event_status TEXT,
    p_lead_target_status lead_status_enum,
    p_conversation_delivery_status TEXT,
    p_dispatch_status dispatch_status_enum,
    p_raw_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_webhook_id UUID;
    v_lead_id UUID;
    v_normalized_status TEXT;
BEGIN
    v_normalized_status := UPPER(TRIM(p_event_status));

    -- 1. Idempotency barrier: silently skip already-processed (provider, msg_id, status)
    INSERT INTO webhook_events (
        provider,
        provider_message_id,
        status,
        raw_payload
    )
    VALUES (
        p_provider,
        p_provider_message_id,
        v_normalized_status,
        COALESCE(p_raw_payload, '{}'::jsonb)
    )
    ON CONFLICT (provider, provider_message_id, status) DO NOTHING
    RETURNING id INTO v_webhook_id;

    IF v_webhook_id IS NULL THEN
        RETURN jsonb_build_object('duplicate', true, 'lead_id', NULL);
    END IF;

    -- 2. Resolve lead_id from conversations or lead_dispatches
    SELECT lead_id INTO v_lead_id
    FROM conversations
    WHERE external_message_id = p_provider_message_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_lead_id IS NULL THEN
        SELECT lead_id INTO v_lead_id
        FROM lead_dispatches
        WHERE provider_message_id = p_provider_message_id
        ORDER BY dispatched_at DESC
        LIMIT 1;
    END IF;

    IF v_lead_id IS NOT NULL THEN
        UPDATE webhook_events
        SET lead_id = v_lead_id
        WHERE id = v_webhook_id;
    END IF;

    -- 3. Update conversations (monotonic trigger prevents delivery_status downgrade)
    IF p_conversation_delivery_status IS NOT NULL THEN
        UPDATE conversations
        SET
            delivery_status = UPPER(p_conversation_delivery_status),
            raw_payload = COALESCE(raw_payload, '{}'::jsonb) || jsonb_build_object('last_webhook', p_raw_payload)
        WHERE external_message_id = p_provider_message_id;
    END IF;

    -- 4. Update lead_dispatches acknowledgment
    IF p_dispatch_status IS NOT NULL THEN
        UPDATE lead_dispatches
        SET
            acknowledged_at = COALESCE(acknowledged_at, NOW()),
            status = p_dispatch_status
        WHERE provider_message_id = p_provider_message_id;
    END IF;

    -- 5. Advance lead status (monotonic trigger prevents status downgrade)
    IF v_lead_id IS NOT NULL AND p_lead_target_status IS NOT NULL THEN
        UPDATE leads
        SET
            status = p_lead_target_status,
            customer_replied_at = CASE
                WHEN p_lead_target_status = 'CUSTOMER_REPLIED' THEN COALESCE(customer_replied_at, NOW())
                ELSE customer_replied_at
            END
        WHERE id = v_lead_id;
    END IF;

    RETURN jsonb_build_object('duplicate', false, 'lead_id', v_lead_id);
END;
$$;

-- 10C. Atomic Owner 1-Tap Click SLA Tracker RPC
CREATE OR REPLACE FUNCTION record_owner_click_sla(
    p_lead_id UUID,
    p_channel TEXT,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_lead RECORD;
    v_org RECORD;
    v_now TIMESTAMPTZ := NOW();
    v_action TEXT;
BEGIN
    SELECT id, organization_id, raw_name, phone_e164, service_requested, status
    INTO v_lead
    FROM leads
    WHERE id = p_lead_id
    LIMIT 1;

    IF v_lead.id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT id, name, slug, owner_dialer_phone
    INTO v_org
    FROM organizations
    WHERE id = v_lead.organization_id
    LIMIT 1;

    IF p_channel = 'call' THEN
        v_action := 'OWNER_CLICKED_CALL';
        UPDATE leads
        SET
            owner_clicked_call_at = COALESCE(owner_clicked_call_at, v_now),
            owner_call_initiated_at = COALESCE(owner_call_initiated_at, v_now)
        WHERE id = p_lead_id;
    ELSIF p_channel = 'wa' THEN
        v_action := 'OWNER_CLICKED_WA';
        UPDATE leads
        SET
            owner_clicked_wa_at = COALESCE(owner_clicked_wa_at, v_now)
        WHERE id = p_lead_id;
    ELSE
        RAISE EXCEPTION 'INVALID_CHANNEL: %', p_channel;
    END IF;

    INSERT INTO audit_logs (
        organization_id,
        action,
        actor_type,
        actor_id,
        details,
        ip_address
    )
    VALUES (
        v_lead.organization_id,
        v_action,
        'system',
        'owner_1tap_tracker',
        jsonb_build_object(
            'lead_id', v_lead.id,
            'channel', p_channel,
            'clicked_at', v_now,
            'user_agent', p_user_agent
        ),
        p_ip_address
    );

    RETURN jsonb_build_object(
        'lead_id', v_lead.id,
        'organization_id', v_lead.organization_id,
        'organization_name', v_org.name,
        'customer_name', v_lead.raw_name,
        'customer_phone_e164', v_lead.phone_e164,
        'service_requested', v_lead.service_requested
    );
END;
$$;

-- 10D. Distributed Sliding-Window Rate Limiter RPC
CREATE OR REPLACE FUNCTION check_rate_limit_sliding_window(
    p_bucket_key TEXT,
    p_limit INTEGER,
    p_window_seconds INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_window_epoch BIGINT;
    v_current_window TIMESTAMPTZ;
    v_prev_window TIMESTAMPTZ;
    v_elapsed_ratio DOUBLE PRECISION;
    v_prev_count INTEGER := 0;
    v_curr_count INTEGER := 0;
    v_weighted_count DOUBLE PRECISION;
BEGIN
    -- Opportunistic cleanup of expired buckets (~5% of calls)
    IF RANDOM() < 0.05 THEN
        DELETE FROM rate_limit_buckets WHERE expires_at < v_now;
    END IF;

    v_window_epoch := FLOOR(EXTRACT(EPOCH FROM v_now) / p_window_seconds)::BIGINT * p_window_seconds;
    v_current_window := TO_TIMESTAMP(v_window_epoch);
    v_prev_window := v_current_window - MAKE_INTERVAL(secs => p_window_seconds);
    v_elapsed_ratio := (EXTRACT(EPOCH FROM v_now) - v_window_epoch) / p_window_seconds;

    SELECT COALESCE(request_count, 0) INTO v_prev_count
    FROM rate_limit_buckets
    WHERE bucket_key = p_bucket_key AND window_start = v_prev_window;

    SELECT COALESCE(request_count, 0) INTO v_curr_count
    FROM rate_limit_buckets
    WHERE bucket_key = p_bucket_key AND window_start = v_current_window;

    v_weighted_count := (v_prev_count * (1.0 - v_elapsed_ratio)) + v_curr_count;

    IF v_weighted_count >= p_limit THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'remaining', 0,
            'retry_after_seconds', GREATEST(1, CEIL(p_window_seconds * (1.0 - v_elapsed_ratio))::INTEGER)
        );
    END IF;

    INSERT INTO rate_limit_buckets (bucket_key, window_start, request_count, expires_at)
    VALUES (
        p_bucket_key,
        v_current_window,
        1,
        v_current_window + MAKE_INTERVAL(secs => p_window_seconds * 2)
    )
    ON CONFLICT (bucket_key, window_start)
    DO UPDATE SET
        request_count = rate_limit_buckets.request_count + 1,
        expires_at = EXCLUDED.expires_at
    RETURNING request_count INTO v_curr_count;

    v_weighted_count := (v_prev_count * (1.0 - v_elapsed_ratio)) + v_curr_count;

    RETURN jsonb_build_object(
        'allowed', true,
        'remaining', GREATEST(0, FLOOR(p_limit - v_weighted_count)::INTEGER),
        'retry_after_seconds', 0
    );
END;
$$;

-- 10E. Record Phone Opt-Out (STOP / ODPC Right to Object)
CREATE OR REPLACE FUNCTION record_phone_opt_out(
    p_phone_e164 TEXT,
    p_organization_id UUID DEFAULT NULL,
    p_source TEXT DEFAULT 'inbound_stop',
    p_reason TEXT DEFAULT 'Customer replied STOP'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO phone_opt_outs (phone_e164, organization_id, source, reason)
    VALUES (TRIM(p_phone_e164), p_organization_id, p_source, p_reason)
    ON CONFLICT (phone_e164, COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET
        opted_out_at = NOW(),
        source = EXCLUDED.source,
        reason = EXCLUDED.reason;
END;
$$;

-- 10F. Claim Overdue Unclicked Leads for SLA Escalation & Expiration
CREATE OR REPLACE FUNCTION claim_overdue_sla_leads(
    p_escalate_after_seconds INTEGER DEFAULT 300,
    p_expire_after_seconds INTEGER DEFAULT 3600,
    p_limit INTEGER DEFAULT 25
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_expired_count INTEGER := 0;
    v_escalated JSONB := '[]'::jsonb;
BEGIN
    -- 1. Transition unengaged leads past expiration SLA to EXPIRED_NO_RESPONSE
    WITH expired AS (
        UPDATE leads
        SET status = 'EXPIRED_NO_RESPONSE'
        WHERE execution_mode = 'LIVE_DISPATCH'
          AND status IN ('DISPATCHED_TO_OWNER', 'SENT', 'WHATSAPP_SENT', 'DELIVERED')
          AND owner_clicked_call_at IS NULL
          AND owner_clicked_wa_at IS NULL
          AND customer_replied_at IS NULL
          AND created_at < (v_now - MAKE_INTERVAL(secs => p_expire_after_seconds))
        RETURNING id, organization_id
    ),
    logged AS (
        INSERT INTO audit_logs (organization_id, action, actor_type, actor_id, details)
        SELECT
            organization_id,
            'SLA_EXPIRED_NO_RESPONSE',
            'system',
            'sla_escalation_cron',
            jsonb_build_object('lead_id', id, 'expired_at', v_now)
        FROM expired
    )
    SELECT COUNT(*) INTO v_expired_count FROM expired;

    -- 2. Atomically claim leads past escalation threshold using SKIP LOCKED
    WITH candidates AS (
        SELECT l.id
        FROM leads l
        WHERE l.execution_mode = 'LIVE_DISPATCH'
          AND l.status IN ('DISPATCHED_TO_OWNER', 'SENT', 'WHATSAPP_SENT', 'DELIVERED')
          AND l.owner_clicked_call_at IS NULL
          AND l.owner_clicked_wa_at IS NULL
          AND l.customer_replied_at IS NULL
          AND l.sla_escalated_at IS NULL
          AND l.created_at < (v_now - MAKE_INTERVAL(secs => p_escalate_after_seconds))
        ORDER BY l.created_at ASC
        LIMIT p_limit
        FOR UPDATE OF l SKIP LOCKED
    ),
    claimed AS (
        UPDATE leads l
        SET sla_escalated_at = v_now
        FROM candidates c
        WHERE l.id = c.id
        RETURNING
            l.id AS lead_id,
            l.organization_id,
            l.raw_name AS customer_name,
            l.phone_e164 AS customer_phone_e164,
            l.service_requested,
            l.created_at
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'lead_id', cl.lead_id,
                'customer_name', cl.customer_name,
                'customer_phone_e164', cl.customer_phone_e164,
                'service_requested', cl.service_requested,
                'created_at', cl.created_at,
                'tenant', jsonb_build_object(
                    'id', o.id,
                    'slug', o.slug,
                    'name', o.name,
                    'niche', o.niche,
                    'owner_dialer_phone', o.owner_dialer_phone,
                    'dispatch_mode', o.dispatch_mode,
                    'whatsapp_phone_number_id', o.whatsapp_phone_number_id,
                    'whatsapp_access_token_encrypted', o.whatsapp_access_token_encrypted,
                    'at_sender_id', o.at_sender_id,
                    'primary_color', o.primary_color,
                    'settings', o.settings
                )
            )
        ),
        '[]'::jsonb
    )
    INTO v_escalated
    FROM claimed cl
    JOIN organizations o ON o.id = cl.organization_id;

    RETURN jsonb_build_object(
        'expired_count', v_expired_count,
        'escalations', v_escalated
    );
END;
$$;

-- ============================================================================
-- 11. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_opt_outs ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all_organizations ON organizations;
CREATE POLICY service_role_all_organizations ON organizations
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all_leads ON leads;
CREATE POLICY service_role_all_leads ON leads
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all_phone_opt_outs ON phone_opt_outs;
CREATE POLICY service_role_all_phone_opt_outs ON phone_opt_outs
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all_conversations ON conversations;
CREATE POLICY service_role_all_conversations ON conversations
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all_dispatches ON lead_dispatches;
CREATE POLICY service_role_all_dispatches ON lead_dispatches
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all_webhook_events ON webhook_events;
CREATE POLICY service_role_all_webhook_events ON webhook_events
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all_rate_limits ON rate_limit_buckets;
CREATE POLICY service_role_all_rate_limits ON rate_limit_buckets
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all_audit_logs ON audit_logs;
CREATE POLICY service_role_all_audit_logs ON audit_logs
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS anon_read_demo_organizations ON organizations;

ALTER TABLE leads ALTER COLUMN consent_accepted SET DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS fallback_claimed_at TIMESTAMPTZ;
CREATE OR REPLACE FUNCTION claim_customer_fallback(p_lead_id UUID, p_org_id UUID, p_phone TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    UPDATE leads l SET fallback_claimed_at = now()
    WHERE l.id = p_lead_id AND l.organization_id = p_org_id AND l.phone_e164 = p_phone
      AND l.execution_mode = 'LIVE_DISPATCH' AND l.consent_accepted AND l.fallback_claimed_at IS NULL
      AND lead_status_rank(l.status) < lead_status_rank('DELIVERED')
      AND NOT EXISTS (SELECT 1 FROM phone_opt_outs o WHERE o.phone_e164 = l.phone_e164
          AND (o.organization_id IS NULL OR o.organization_id = l.organization_id))
      AND NOT EXISTS (SELECT 1 FROM lead_dispatches d WHERE d.lead_id = l.id AND d.channel = 'AFRICAS_TALKING_SMS');
    RETURN FOUND;
END $$;

REVOKE EXECUTE ON FUNCTION ingest_lead_atomic(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, NUMERIC, execution_mode_enum, JSONB, JSONB, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ingest_lead_atomic(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, NUMERIC, execution_mode_enum, JSONB, JSONB, BOOLEAN, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION apply_webhook_event_atomic(webhook_provider_enum, TEXT, TEXT, lead_status_enum, TEXT, dispatch_status_enum, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_webhook_event_atomic(webhook_provider_enum, TEXT, TEXT, lead_status_enum, TEXT, dispatch_status_enum, JSONB) TO service_role;
REVOKE EXECUTE ON FUNCTION record_owner_click_sla(UUID, TEXT, INET, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_owner_click_sla(UUID, TEXT, INET, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION check_rate_limit_sliding_window(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION check_rate_limit_sliding_window(TEXT, INTEGER, INTEGER) TO service_role;
REVOKE EXECUTE ON FUNCTION record_phone_opt_out(TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_phone_opt_out(TEXT, UUID, TEXT, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION claim_overdue_sla_leads(INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_overdue_sla_leads(INTEGER, INTEGER, INTEGER) TO service_role;
REVOKE EXECUTE ON FUNCTION claim_customer_fallback(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_customer_fallback(UUID, UUID, TEXT) TO service_role;
COMMIT;
