# Chameleon Engine — 2026 Production Architecture & Market Research

## 1. Meta WhatsApp Cloud API & Africa's Talking Standards (2026)

### Meta WhatsApp Cloud API
- **Cloud-Only Standard:** Meta retired the On-Premises WhatsApp API in October 2025; WhatsApp Cloud API (`graph.facebook.com`) is the sole supported architecture.
- **Graph API versioning.** See the [November lifecycle and Kenya tariff review](KENYA_LAUNCH.md). The adapter defaults to v27.0.
- **Billing & Quality Guardrails:** Meta shifted from conversation-based billing to per-delivered-template-message billing (Marketing, Utility, Authentication) and meters free-form service replies beyond the 1,000 monthly free service-message allowance. `WATERFALL_PROD` mode minimizes unnecessary dual-channel spend while preserving sub-second lead acknowledgment.
- **Webhook Security:** Requests carry `X-Hub-Signature-256: sha256=<hex>` computed over the raw request body using `WHATSAPP_APP_SECRET`, verified via constant-time `crypto.timingSafeEqual`.

### Africa's Talking SMS (East Africa)
- **Webhook Transport:** Both Delivery Reports (DLRs) and Two-Way Inbound SMS callbacks arrive via `POST` with `application/x-www-form-urlencoded` (with JSON supported defensively in our parser) and expect a fast `200 OK` response (`"OK"`) to avoid retry storms.
- **DLR Fields:** `id`, `status` (`Success`, `Failed`, `Buffered`, `Rejected`), `phoneNumber`, `networkCode` (e.g., `63902` Safaricom KE), `failureReason`, and `retryCount`.
- **Inbound SMS Fields:** `from`, `to` (shortcode/sender), `text`, `date`, `id`, and `linkId`.
- **Sender ID Fallback:** If a tenant's custom `at_sender_id` triggers a sender-rejection error, `AfricasTalkingAdapter` automatically falls back once to the system default sender.

---

## 2. Serverless Concurrency & Background Execution (Vercel vs QStash)

- **Vercel Fluid Compute & `waitUntil()`:** `waitUntil()` continues executing background promises after returning `200 OK`, bounded by the route's `maxDuration` (`export const maxDuration = 60` on `/api/leads/submit`). However, `waitUntil()` provides no built-in cross-invocation retries if a container terminates.
- **Upstash QStash Decoupling:** For `WATERFALL_PROD` delayed SMS fallback checks (e.g., 15-second delivery verification window), publishing to Upstash QStash (`Upstash-Delay`) decouples the timer from the intake Lambda and adds automatic retries. `/api/internal/waterfall-sms` verifies `Upstash-Signature` HS256 JWTs (`QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY`) with replay (`exp`/`nbf`) and SHA-256 body hash checks, plus constant-time `x-internal-secret` fallback.

---

## 3. PostgreSQL & Supabase Supavisor Transaction Pooling

- **Supavisor Transaction Mode (Port 6543):** Physical backend Postgres connections are assigned only for the duration of a single SQL transaction and returned to the pool on `COMMIT`/`ROLLBACK`.
- **Advisory Lock Discipline:** Session-level locks (`pg_advisory_lock`) leak or orphan across pooled connections under transaction pooling. `ingest_lead_atomic` strictly uses transaction-scoped `pg_advisory_xact_lock(hashtextextended(org_slug || ':' || phone_e164, 0))`, guaranteeing automatic lock release at transaction end and race-free 10-minute sliding-window deduplication in one database round-trip.
- **Idempotency & Monotonic State Machine:** `webhook_events` deduplicates retries on `UNIQUE (provider, provider_message_id, status)` while `enforce_lead_status_progression` prevents delayed webhooks (`SENT`) from regressing later states (`DELIVERED`, `CUSTOMER_REPLIED`).

---

## 4. Enterprise B2B UI Design Benchmark (Linear / Vercel / Stripe)

- **Strict 3-Color Light Palette:**
  1. **Canvas Light:** `#F8FAFC` page canvas, `#FFFFFF` elevated surfaces, `#E2E8F0` 1px structural borders, soft shadows (`shadow-sm` / `shadow-card`).
  2. **Executive Slate:** `#0F172A` primary ink and `#334155` muted secondary text, paired with `tabular-nums` monospace telemetry figures.
  3. **Dynamic Brand Accent (`var(--brand-color)`):** Validated `#RRGGBB` query injection scoped strictly to primary CTAs, active tabs, focus rings, and 10% pastel badges (`bg-brand/10 text-brand`).
- **White-Label Purity:** Zero attribution footers, framework logos, or marketing watermarks.
