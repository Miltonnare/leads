# Chameleon Engine

Chameleon captures quote requests for Kenyan service businesses and routes them to the person responsible for follow-up. A customer selects a service, provides a callback number and consents to contact. In live mode the system can acknowledge the inquiry on WhatsApp, alert the owner by SMS and record when the owner taps a call or WhatsApp link.

The application uses Next.js App Router, TypeScript, Supabase PostgreSQL, Meta WhatsApp Cloud API and Africa's Talking SMS. The local production build and browser flows passed verification on 13 November 2026. Hosted intake latency and delivery to Kenyan handsets remain pilot checks. [Kenya launch assessment and client onboarding](docs/KENYA_LAUNCH.md)

## Run the local sandbox

Use Node.js 22 and npm. From the repository root, with Supabase and provider credentials unset, run:

```sh
npm ci
npm run dev
```

Open [the local intake form](http://localhost:3000/). Select **Other**, enter a custom requirement, check the consent box and submit. The confirmation and **Speed Diagnostics** tab show the simulated result. With Supabase unset, sandbox submissions are deduplicated in process memory for ten minutes. Restarting the server clears that history.

## Branded previews and live dispatch

The server verifies an HMAC-SHA256 signature over the client name, accent color, owner phone, niche and expiration before rendering tenant branding on the form, page title or privacy notice. Missing, expired or invalid signatures display the neutral sandbox. Supported niches are `solar`, `borehole`, `vehicle`, `dental`, `plant` and `general`.

On a configured deployment, request a signed link from the admin endpoint. This PowerShell example reads the admin key and app URL from the shell environment. Use the intended tenant's details and a company-controlled number.

```powershell
$body = @{
    client = 'Apex Solar'
    color = '0284c7'
    phone = $env:TEST_OWNER_PHONE
    niche = 'solar'
    ttlSeconds = 3600
} | ConvertTo-Json

$link = Invoke-RestMethod -Method Post -Uri "$env:NEXT_PUBLIC_APP_URL/api/admin/sign-demo" `
    -Headers @{ 'x-admin-api-key' = $env:ADMIN_API_KEY } -ContentType 'application/json' -Body $body
$link.url
```

**Submitting through a valid signed link enables paid dispatch** and requires a configured database. Each organization has a separate dispatch mode.

| Mode | Enabled-channel behavior |
| --- | --- |
| `PARALLEL_DEMO` | Sends the customer WhatsApp acknowledgment, customer SMS and owner alert concurrently. Newly registered organizations default to this mode. |
| `WATERFALL_PROD` | Starts WhatsApp and the owner alert together. An immediate WhatsApp failure or an elapsed delivery window triggers a customer SMS eligibility check. The default delay is 15 seconds. |

## Intake, delivery and recovery

1. Intake validates consent and the service request, normalizes the phone to E.164 and applies per-IP and per-phone limits. The limiter uses Upstash Redis when configured, with PostgreSQL and process-memory fallbacks.
2. The `ingest_lead_atomic` RPC uses a transaction-scoped advisory lock to deduplicate concurrent inquiries. A duplicate returns the existing lead ID. A new lead records consent time and notice version. The response includes intake timing while messaging runs in the background.
3. Delivery callbacks update dispatch and conversation records. Database triggers prevent a delayed status from moving a lead backward. Inbound STOP messages record an opt-out. Owner link clicks record a timestamp for SLA tracking.
4. Before a waterfall SMS, `claim_customer_fallback` checks tenant, destination, consent, opt-outs, lead status and prior SMS dispatches. Only one worker can claim the fallback. A crash after the claim can leave an unsent message. Reconcile the claim, dispatch log and provider record before a manual resend.

Customer acknowledgments use a 160-septet GSM-7 budget, including two-septet extension characters. Owner alerts include two tracking links and may span multiple billed segments. The launch assessment models those segments separately.

## Configure a deployment

| Component | Configuration |
| --- | --- |
| Database | Apply the full migration to Supabase PostgreSQL. Set `NEXT_PUBLIC_SUPABASE_URL` to the HTTPS project URL and keep `SUPABASE_SERVICE_ROLE_KEY` server-side. The app calls PostgREST over HTTPS. Reserve the PostgreSQL pooler connection string for SQL tooling. [Migration and RPC definitions](schema.sql) |
| App and previews | Set `NEXT_PUBLIC_APP_URL`, `ADMIN_API_KEY` and `DEMO_SIGNING_SECRET`. The public URL is used for signed links, owner redirects and delayed callbacks. |
| WhatsApp | Configure the phone number ID, access token, webhook verification token and app secret. The adapter defaults to Graph `v27.0` and English template `lead_instant_acknowledgement` with customer name, company name and service. For tenant credentials, pair the number ID with an AES-256-GCM encrypted token and set `TOKEN_ENCRYPTION_KEY`. |
| SMS | Configure the Africa's Talking username, API key and webhook secret. Confirm transactional sender approval and a working opt-out contact on each target network. |
| Background work | Configure QStash for delayed waterfall checks or allow the runtime to execute the in-process timer. Configure the cron secret and schedule SLA sweeps. Defaults are five minutes to escalate and one hour to expire an eligible lead. |

Use the environment template for the full variable list, limits and delay overrides. Before enabling a tenant, confirm its sender approvals, transfer safeguards, retention schedule and rights-request contact. [Environment template](.env.example) · [Kenya onboarding runbook](docs/KENYA_LAUNCH.md)

## HTTP routes

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/leads/submit` | Accepts an inquiry. Returns 200 for new or duplicate submissions, 400 for malformed or schema-invalid input, 422 for an invalid phone and 429 for throttling. |
| POST | `/api/admin/sign-demo` | Issues a signed preview URL using an admin key. |
| GET, POST | `/api/webhooks/whatsapp` | Handles the Meta subscription challenge, signed delivery events and inbound replies. |
| POST | `/api/webhooks/africastalking` | Receives authenticated delivery reports and inbound SMS callbacks. |
| POST | `/api/internal/waterfall-sms` | Handles a delayed fallback using QStash signing keys or the configured internal secret. |
| GET, POST | `/api/cron/sla-escalation` | Runs the authenticated owner escalation and lead expiry sweep. |
| GET | `/r/c/<id>`, `/r/w/<id>` | Records the owner click and redirects to the dialer or WhatsApp. Accepts UUIDs and compact lead IDs. |
| GET | `/privacy` | Displays the processing notice and controller contact. |

## Verification

```sh
npm run type-check
npm test
npm run build
```

For browser verification, start the production build with provider credentials unset. In a second terminal, run the browser suite. It requires a resolvable Playwright installation and its Chromium browser, or the path to a local Chromium-based browser in `BROWSER_EXECUTABLE`. Set `PLAYWRIGHT_MODULE` to an installed Playwright module path if the package is installed outside this repository.

```sh
# Terminal 1
npm run start -- -H 127.0.0.1 -p 3457

# Terminal 2
node tests/browser.mjs
```

| Check | Recorded result on 13 November 2026 |
| --- | --- |
| Static checks and build | TypeScript, all four pipeline suites and the Next.js production build passed. The suites exercise provider behavior with test doubles. |
| PostgreSQL 18 | The migration applied twice. Direct database checks passed for duplicate intake, repeat fallback claims and status regression. |
| Local HTTP | Validation, authorization, security-header and duplicate-submission assertions passed. Server-reported sandbox intake took 5–6 ms across two runs. |
| Headless Edge | The form passed at 375, 768 and 1280 px, including custom service, consent, submission and diagnostics. The suite observed zero console errors, failed requests or unexpected layout shift. |

The hosted target is intake under 250 ms. Measure p95 intake from Kenya against hosted Supabase, then measure handset delivery separately. [Browser suite](tests/browser.mjs) · [Pipeline suite](tests/pipeline.test.mjs)

## Code map

| Directory | Responsibility |
| --- | --- |
| [Domain](src/core/domain) and [ports](src/core/ports) | Phone normalization, service presets, SMS formatting, state transitions and interfaces |
| [Adapters](src/adapters) | Supabase persistence, provider clients, rate limiting, credential encryption and runtime scheduling |
| [Services](src/services) | Lead intake, dispatch, webhook processing, preview signing and SLA orchestration |
| [App routes](src/app) and [components](src/components) | HTTP handlers, signed preview rendering, privacy notice and intake form |
