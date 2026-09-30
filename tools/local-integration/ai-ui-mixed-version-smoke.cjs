// U11 compatibility check: old v0.1.18 frontend against the new API contract,
// then reload into the current frontend. All API calls are deterministic mocks.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '../..');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  const oldFrontend = url.searchParams.has('old') || new URL(request.headers.referer || 'http://127.0.0.1').searchParams.has('old');
  let data;
  try {
    if (oldFrontend) data = execFileSync('git', ['show', `v0.1.18:${path.relative(root, file).replaceAll(path.sep, '/')}`], { cwd: root, maxBuffer: 20 * 1024 * 1024 });
    else data = fs.readFileSync(file);
  } catch {
    response.writeHead(404).end(); return;
  }
  response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(data);
});
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const closedAt = new Date(Date.now() + 60 * 60_000).toISOString();
const bundle = { status: 'success', mode: 'ai_bundle', contractVersion: 'ai-bundle-v1', snapshotId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  main: [1, 3, 2], counter: [2, 4, 1], hole: [6, 5, 4], narrative: 'CURRENT_V019_RESULT' };

(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let browser;
  const requests = [];
  let geminiRequests = 0;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === `http://127.0.0.1:${server.address().port}`) { await route.continue(); return; }
      if (url.pathname.endsWith('/functions/v1/predictions') && route.request().method() === 'GET' && url.searchParams.get('action') === 'races') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ raceDate: today, predictionMode: 'ai_bundle', predictionContractVersion: 'ai-bundle-v1',
          stadiums: [{ stadiumCode: 24, hasRaces: true, races: [{ raceNumber: 12, closedAt }] }] }) });
        return;
      }
      if (url.pathname.endsWith('/functions/v1/predictions') && route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        requests.push(body);
        if (body.action !== 'generate' || body.contractVersion !== 'ai-bundle-v1') {
          await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ status: 'failed', retryable: false, mode: 'ai_bundle', contractVersion: 'ai-bundle-v1' }) });
        } else {
          await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ status: 'generating', mode: 'ai_bundle', contractVersion: 'ai-bundle-v1',
            jobId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', remainingMs: 60_000, retryAfterMs: 100 }) });
        }
        return;
      }
      if (url.pathname.endsWith('/functions/v1/predictions') && route.request().method() === 'GET' && url.searchParams.get('action') === 'prediction-job') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bundle) });
        return;
      }
      if (url.hostname === 'generativelanguage.googleapis.com') geminiRequests++;
      await route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    const base = `http://127.0.0.1:${server.address().port}/index.html`;
    await page.goto(`${base}?old=1`, { waitUntil: 'domcontentloaded' });
    assert.match(await page.locator('.version').textContent(), /v0\.1\.18/);
    await page.waitForFunction(() => document.querySelector('#stadium-select')?.options?.length > 1);
    await page.locator('#stadium-select').selectOption('大村');
    await page.locator('#race-select').selectOption('12R');
    await page.locator('#start-btn').click();
    await page.locator('#prediction-status').filter({ hasText: '解析できませんでした' }).waitFor({ timeout: 10_000 }).catch(async () => {
      throw new Error(`old frontend did not reach failure state; version=${await page.locator('.version').textContent()}, status=${await page.locator('#prediction-status').textContent()}, posts=${requests.length}`);
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].action, undefined, 'old frontend must retain the old POST shape');
    assert.equal(geminiRequests, 0, 'legacy POST against new contract must not call Gemini');

    await page.goto(base, { waitUntil: 'domcontentloaded' });
    assert.match(await page.locator('.version').textContent(), /v0\.1\.19/);
    await page.waitForFunction(() => document.querySelector('#stadium-select')?.options?.length > 1);
    await page.locator('#stadium-select').selectOption('大村');
    await page.locator('#race-select').selectOption('12R');
    await page.locator('#start-btn').click();
    await page.waitForFunction(() => document.querySelector('#race-development-text')?.textContent === 'CURRENT_V019_RESULT', null, { timeout: 40_000 });
    assert.equal(requests.length, 2);
    assert.equal(requests[1].action, 'generate');
    assert.equal(requests[1].contractVersion, 'ai-bundle-v1');
    assert.equal(geminiRequests, 0);
    console.log('PASS: U11 old v0.1.18 POST safely rejected by new API contract with zero model requests');
    console.log('PASS: reload selected v0.1.19 frontend/version and its AI bundle contract completed normally');
    console.log('INFO: synthetic local API only; no Supabase DB, Gemini, hosted service, or public URL used');
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
})().catch((error) => { console.error(`${error.name || 'Error'}: ${error.message || 'mixed-version smoke failed'}`); process.exitCode = 1; });
