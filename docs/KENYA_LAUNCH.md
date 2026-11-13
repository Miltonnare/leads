# Kenya launch assessment · 13 November 2026

### Integrations and commercial assumptions

Meta lists Graph v27.0 as current and supports versions for at least two years. Pin v27.0 for new deployments. The exact retirement date was unavailable in the changelog. Confirm the approved category in WhatsApp Manager before quoting rates. A receipt should refer to the specific inquiry. Adding an offer risks marketing classification. The official price card required login. Model USD 0.0040 per delivered utility and USD 0.0225 per marketing message as assumptions. [Version policy](https://developers.facebook.com/docs/graph-api/guides/versioning) · [Pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)

Africa's Talking uses /version1/messaging. Its published Kenya sheet lists KES 0.80 per basic SMS segment and KES 14,100 for a bundled Safaricom/Airtel ID, excluding VAT. Safaricom processes Monday and Thursday submissions for next-day readiness. Airtel quotes 7–14 days. Transactional migration typically adds two days. The guide identifies setup fees. A separate carrier deposit and universal Kenyan quiet-hours window remain unconfirmed. Obtain the route-specific window, reply path and DND terms in writing. Honor suppression and keep promotional sends disabled. [Carrier documents and prices](https://help.africastalking.com/en/articles/12381163-bulk-sms-kenya) · [DND](https://help.africastalking.com/en/articles/5209677-userinblacklist)

A GSM-7 segment carries 160 septets, or 153 per multipart segment. Extension characters cost two septets. Unicode capacities are 70 and 67 UTF-16 units. Replacing one apostrophe in a 150-character ASCII text with a smart quote can turn one segment into three. Count the entire rendered owner alert including both links. [Encoding reference](https://www.twilio.com/docs/glossary/what-sms-character-limit)

Supabase exposes HTTPS /rest/v1. PostgreSQL transaction pooling uses a separate connection string. Upstash QStash publishes to /v2/publish and Redis uses the database-specific HTTPS REST endpoint. Vercel waitUntil extends execution within the function lifetime. These product references list no fixed retirement date for these interfaces. [Supabase REST](https://supabase.com/docs/guides/api) · [Pooling](https://supabase.com/kb/troubleshooting/supavisor-faq-YyP5tI) · [QStash](https://upstash.com/docs/qstash/howto/publishing) · [Redis REST](https://upstash.com/docs/redis/features/restapi) · [Vercel](https://vercel.com/docs/functions/functions-api-reference)

### Privacy and economics

Document the controller, collection purpose, recipients, transfer destinations and safeguards before intake. Keep an affirmative, purpose-specific consent record. Marketing requires a separate decision and accessible opt-out. Under regulation 19 each controller sets and reviews a necessity-based retention schedule. A website notice alone cannot establish a lawful transfer. Record the applicable basis under sections 48–49, especially for sensitive data. Limit the initial pilot to commercial project inquiries. [General Regulations](https://new.kenyalaw.org/akn/ke/act/ln/2021/263/eng%402022-12-31/source) · [Data Protection Act](https://new.kenyalaw.org/akn/ke/act/2019/24)

Planning case per inquiry, before tax: one delivered utility acknowledgement, two owner SMS segments and a one-segment customer fallback on 20% of inquiries cost USD 0.004 + KES 1.76. At an assumed KES 130/USD this is USD 0.01754, or USD 17.54 per 1,000 inquiries. Escalations, additional replies, tax and carrier mix change the bill. At USD 750/month, USD 200/month servicing cost and 12 paid months, gross contribution LTV before acquisition and onboarding is USD 6,600 with messaging passed through. Demand and churn still need a paid pilot. Intake latency and carrier delivery latency must be measured separately.

### First paid pilot

| Prospect and buyer | Trigger for outreach | How the buyer measures recovery |
| --- | --- | --- |
| Commercial solar EPC, sales director | Rooftop or storage requests arrive while sales engineers are on site | Qualified site surveys booked, then gross contribution from won installations |
| Borehole contractor, managing director | Survey inquiries sit overnight in a shared inbox | Survey-to-drilling conversion and incremental drilling margin |
| Plant hire fleet, dispatch manager | Excavator availability requests expire before a dispatcher calls | Incremental paid hire days net of transport and operator cost |
| Commercial vehicle importer, fleet sales lead | Fleet quotations stall while specifications are collected | Won import mandates and net brokerage margin |

Start with one branch and one quote form. Ask for the previous four weeks of inquiries, first-contact timestamps, qualified opportunities and wins. Agree on a comparison cohort or staggered rollout. Review matched leads weekly, exclude existing opportunities and duplicate contacts, then reconcile closed jobs with invoices. A faster callback is an intermediate metric. Measure incrementality over the client's actual sales cycle before expanding.

Offer USD 1,500 setup and USD 500/month for one branch, USD 2,500 and USD 750/month for a multi-team pilot, or USD 3,500 and USD 1,200/month for a multi-branch rollout. Define included forms, training and reporting in the order. Pass through actual message segments, carrier fees and taxes. At the middle tier, allocating setup over 12 months and including USD 17.54 monthly telecom yields USD 975.87 monthly cost. One *incremental closed sale* contributing USD 10,735 after fulfillment yields approximately 10x net ROI, calculated as (10,735 − 975.87) / 975.87. At a 20% close rate, one recovered inquiry is worth only USD 2,147 in expectation. Break-even and 10x are different sales claims.

### Client onboarding

1. Record the legal entity, tax certificate, authorized representative, service area, escalation owner and rights-request contact. Agree the processing contract, retention periods for leads and logs, hosting regions, lawful transfers and deletion responsibilities.
2. Submit sender name (maximum 11 characters), incorporation or trademark evidence, authorization letter and transactional migration letter. Obtain the carrier order, tax-inclusive quote and approval for each network. Confirm a working opt-out contact for one-way IDs.
3. In the client's Meta business portfolio verify the business, attach the WABA, register the number and display name, configure billing, and submit an inquiry-specific receipt template. Record the approved language, category, name and variable order.
4. Configure server-side credentials, encrypt each tenant token with the deployment encryption key and keep the number ID paired with that token. Set separate admin, preview, webhook and cron secrets. Register the HTTPS callbacks, complete Meta's challenge, subscribe to messages and exercise signing-key rotation. Keep callback tokens out of access logs.
5. Use company-controlled test handsets on both networks to verify receipt, delayed delivery, suppression and STOP. Compare provider IDs and billed segments with dispatch records. Test withdrawal through the actual branded sender contact. Review the p95 intake time from Kenya separately from device receipt time.
6. Run the paid pilot, reconcile billing and qualified appointments weekly, then review closed-job contribution with the buyer. Suspend the affected route if suppression or consent verification fails.

### Buyer objections

| Buyer concern | Response and acceptance evidence |
| --- | --- |
| “What if WhatsApp never arrives?” | Inspect WhatsApp receipt history and the fallback claim, then trace the SMS report on a test handset. A timed-out provider request can have an unknown outcome. Reconcile that request before any manual resend. |
| “Our sender is filtered.” | Verify the approved transactional class on each carrier, inspect the rejection reason and honor DND. Escalate with the provider message ID. |
| “Who can read customer details?” | Show the tenant contact, signed preview, server-only database permissions, processor terms and the deletion exercise for that client. |
| “This will take weeks to set up.” | Build the intake and train the response owner while carriers review the ID. Schedule live acceptance only after the slowest required network approves it. |

### Verification record

Local TypeScript check, four pipeline suites and Next.js production compilation passed. PostgreSQL 18 applied the migration twice and exercised duplicate intake, repeat fallback claim and status regression. A loopback production server returned the expected validation, authorization and duplicate responses. Headless Edge completed the custom-service and consent flow at 375, 768 and 1280 pixels with zero console errors, failed requests and measured CLS. Sandbox application intake was 5 ms in one run. These measurements exclude hosted Supabase latency, cold starts in Kenya and carrier delivery. A worker crash after claiming an SMS can leave an unsent claim for reconciliation. Paid delivery, transfer arrangements, the account rate card, demand and ROI remain pilot gates.
