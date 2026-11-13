// Run against a local production build with provider credentials unset.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomInt } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'http://127.0.0.1:' + (process.env.TEST_PORT || '3457');
const post = (path, body, headers = {}) => fetch(base + path, {
  method: 'POST', body, headers: { 'content-type': 'application/json', ...headers },
});

const submit = '/api/leads/submit';
const phone = () => '0712' + String(randomInt(100000, 999999));
const sample = { fullName: 'QA Contact', phone: phone(), serviceRequested: 'Site assessment',
  organizationSlug: 'preview', consentAccepted: true };
for (const [body, status] of [['{', 400], [JSON.stringify({ ...sample, consentAccepted: false }), 400],
    [JSON.stringify({ ...sample, phone: '000000000' }), 422]]) {
  const response = await post(submit, body);
  assert.equal(response.status, status);
  assert.equal((await response.json()).success, false);
}
const first = await post(submit, JSON.stringify(sample));
assert.equal(first.headers.get('x-content-type-options'), 'nosniff');
assert.equal(first.status, 200);
const accepted = await first.json();
assert.equal(accepted.executionMode, 'SANDBOX_SIMULATION');
const duplicate = await (await post(submit, JSON.stringify(sample))).json();
assert.equal(duplicate.leadId, accepted.leadId);
assert.equal(duplicate.status, 'DEDUPLICATED');
assert.equal((await post('/api/admin/sign-demo', '{}')).status, 401);
console.log('HTTP intake, duplicate, validation and authorization passed. Sandbox intake', accepted.intakeLatencyMs, 'ms');

const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE });
try {
  for (const width of [375, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('requestfailed', req => errors.push(req.url()));
    page.on('response', res => { if (res.status() >= 400) errors.push(res.status() + ' ' + res.url()); });
    await page.addInitScript(() => {
      window.layoutShift = 0;
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.layoutShift += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(base + '/?client=UnverifiedBrand&sig=invalid&exp=9999999999', { waitUntil: 'networkidle' });
    assert.ok(!(await page.title()).includes('UnverifiedBrand'));
    assert.equal(await page.getByText('Live Dispatch', { exact: true }).count(), 0);
    await page.locator('button[type=submit]').click();
    await page.locator('[aria-invalid=true]').first().waitFor();
    await page.locator('#lead-full-name').fill('Site Manager');
    await page.locator('#lead-phone').fill(phone());
    await page.locator('#lead-service').selectOption('__CUSTOM_SERVICE__');
    await page.locator('#lead-custom-service').fill('Commercial site inspection');
    await page.getByRole('checkbox').check();
    await page.locator('button[type=submit]').click();
    await page.getByText('Estimate logged in sandbox simulation').waitFor();
    await page.getByRole('button', { name: 'View speed breakdown' }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.evaluate(() => window.layoutShift), 0);
    assert.deepEqual(errors, []);
    console.log(width + 'px: validation, custom service, consent, submission and diagnostics passed; CLS 0');
    await page.close();
  }
} finally {
  await browser.close();
}
