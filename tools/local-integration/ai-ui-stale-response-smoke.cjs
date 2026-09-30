// U08 navigation and same-page post-timeout legs. All service traffic is mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '../..');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
const server = http.createServer((request, response) => {
  const file = path.resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)}`);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(data);
  });
});
const freshBundle = { status: 'success', mode: 'ai_bundle', contractVersion: 'ai-bundle-v1', snapshotId: '88888888-8888-4888-8888-888888888888',
  main: [1, 3, 2], counter: [2, 4, 1], hole: [6, 5, 4], narrative: 'NEW_RUN_RESULT' };
const staleBundle = { ...freshBundle, snapshotId: '99999999-9999-4999-8999-999999999999', narrative: 'STALE_OLD_RESULT' };
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const futureClose = `${new Date(Date.now() + 60 * 60 * 1000).toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo', hour12: false }).replace(' ', 'T')}+09:00`;

(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let browser;
  let releaseFirst;
  let firstRoute;
  let releaseTimedOut;
  let timedOutRoute;
  let postCount = 0;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === `http://127.0.0.1:${server.address().port}`) { await route.continue(); return; }
      if (url.pathname.endsWith('/functions/v1/predictions') && route.request().method() === 'GET' && url.searchParams.get('action') === 'races') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ predictionMode: 'ai_bundle', predictionContractVersion: 'ai-bundle-v1', raceDate: today,
          stadiums: [{ stadiumCode: 24, hasRaces: true, races: [{ raceNumber: 12, closedAt: futureClose }] }] }) });
        return;
      }
      if (url.pathname.endsWith('/functions/v1/predictions') && route.request().method() === 'POST') {
        postCount++;
        if (postCount === 1) {
          firstRoute = route;
          await new Promise((resolve) => { releaseFirst = resolve; });
          try { await firstRoute.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(staleBundle) }); } catch { /* navigation may have aborted the old request */ }
          return;
        }
        if (postCount === 3) {
          timedOutRoute = route;
          await new Promise((resolve) => { releaseTimedOut = resolve; });
          try { await timedOutRoute.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(staleBundle) }); } catch { /* client timeout aborted this request */ }
          return;
        }
        if (postCount === 4) {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(freshBundle) });
          return;
        }
        await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ status: 'generating', mode: 'ai_bundle',
          contractVersion: 'ai-bundle-v1', jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', remainingMs: 60_000, retryAfterMs: 100 }) });
        return;
      }
      if (url.pathname.endsWith('/functions/v1/predictions') && route.request().method() === 'GET' && url.searchParams.get('action') === 'prediction-job') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(freshBundle) });
        return;
      }
      if (url.pathname.endsWith('/functions/v1/comments') && route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ comments: [] }) });
        return;
      }
      await route.abort('blockedbyclient');
    });

    const page = await context.newPage();
    const base = `http://127.0.0.1:${server.address().port}/index.html`;
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#stadium-select')?.options?.length > 1);
    await page.locator('#stadium-select').selectOption('大村');
    await page.locator('#race-select').selectOption('12R');
    await page.locator('#start-btn').click();
    await page.getByRole('status').filter({ hasText: 'レース解析中…' }).waitFor({ timeout: 5_000 });
    await page.goto(`${base}?fresh-page=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#stadium-select')?.options?.length > 1);
    assert.equal(await page.locator('#start-btn').isDisabled(), true, 'new page starts idle');
    await page.locator('#stadium-select').selectOption('大村');
    await page.locator('#race-select').selectOption('12R');
    await page.locator('#start-btn').click();
    await page.waitForFunction(() => document.querySelector('#race-development-text')?.textContent === 'NEW_RUN_RESULT', null, { timeout: 40_000 });
    assert.equal(postCount, 2, 'the fresh page must complete its own request');
    releaseFirst?.();
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(await page.locator('#race-development-text').textContent(), 'NEW_RUN_RESULT');
    assert.equal((await page.locator('[data-prediction="counter"]').textContent()).replace(/\s+/g, ''), '2-4-1');
    assert.equal(await page.locator('#start-btn').isDisabled(), false);
    console.log('PASS: U08 navigation case: delayed old-page POST response did not overwrite the fresh page result or control state');

    const samePage = await context.newPage();
    await samePage.addInitScript(() => {
      const nativeSetTimeout = window.setTimeout.bind(window);
      let shortened = false;
      window.setTimeout = (callback, delay, ...args) => {
        if (!shortened && delay === 90_000) { shortened = true; delay = 250; }
        return nativeSetTimeout(callback, delay, ...args);
      };
    });
    await samePage.goto(base, { waitUntil: 'domcontentloaded' });
    await samePage.waitForFunction(() => document.querySelector('#stadium-select')?.options?.length > 1);
    await samePage.locator('#stadium-select').selectOption('大村');
    await samePage.locator('#race-select').selectOption('12R');
    await samePage.locator('#start-btn').click();
    await samePage.locator('#prediction-status').getByText('予想を生成できませんでした。もう一度お試しください。').waitFor({ timeout: 5_000 });
    assert.equal(postCount, 3, 'timed-out request should remain pending while the UI recovers');
    assert.equal(await samePage.locator('#start-btn').isDisabled(), false, 'timeout must restore START');
    await samePage.locator('#start-btn').click();
    await samePage.waitForFunction(() => document.querySelector('#race-development-text')?.textContent === 'NEW_RUN_RESULT', null, { timeout: 40_000 });
    assert.equal(postCount, 4, 'the next same-page run must use its own request');
    releaseTimedOut?.();
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(await samePage.locator('#race-development-text').textContent(), 'NEW_RUN_RESULT', 'late timed-out response must not replace the fresh narrative');
    assert.equal((await samePage.locator('[data-prediction="counter"]').textContent()).replace(/\s+/g, ''), '2-4-1');
    assert.equal(await samePage.locator('#start-btn').isDisabled(), false, 'late timed-out response must not change new-run controls');
    console.log('PASS: U08 same-page case: late timed-out POST response did not overwrite the next run result or control state');
    console.log('INFO: local browser + mock API only; no Supabase, Gemini, hosted service, or public URL used');
    await context.close();
  } finally {
    releaseFirst?.();
    releaseTimedOut?.();
    if (browser) await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
})().catch((error) => { console.error(`${error.name || 'Error'}: ${error.message || 'stale-response smoke failed'}`); process.exitCode = 1; });
