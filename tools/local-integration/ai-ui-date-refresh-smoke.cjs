// Deterministic local browser check for scheduled race availability refresh.
// All non-loopback traffic is blocked; the API response is synthetic.
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

(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.clock.install({ time: new Date('2026-09-27T23:58:00+09:00') });
    const requestedDates = [];
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === `http://127.0.0.1:${server.address().port}`) { await route.continue(); return; }
      if (url.pathname.endsWith('/functions/v1/predictions') && route.request().method() === 'GET' && url.searchParams.get('action') === 'races') {
        const raceDate = url.searchParams.get('raceDate');
        requestedDates.push(raceDate);
        const nextDay = raceDate === '2026-09-28';
        const body = { predictionMode: 'ai_bundle', predictionContractVersion: 'ai-bundle-v1', raceDate,
          stadiums: [{ stadiumCode: 24, hasRaces: true, races: [{ raceNumber: nextDay ? 1 : 12,
            closedAt: nextDay ? '2026-09-28T00:05:00+09:00' : '2026-09-27T23:59:00+09:00' }] }] };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        return;
      }
      if (url.pathname.endsWith('/functions/v1/predictions') && route.request().method() === 'POST') {
        await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ status: 'generating', mode: 'ai_bundle',
          contractVersion: 'ai-bundle-v1', jobId: '77777777-7777-4777-8777-777777777777', remainingMs: 105_000, retryAfterMs: 100 }) });
        return;
      }
      if (url.pathname.endsWith('/functions/v1/predictions') && route.request().method() === 'GET' && url.searchParams.get('action') === 'prediction-job') {
        await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ status: 'generating', mode: 'ai_bundle',
          contractVersion: 'ai-bundle-v1', jobId: '77777777-7777-4777-8777-777777777777', remainingMs: 105_000, retryAfterMs: 100 }) });
        return;
      }
      await route.abort('blockedbyclient');
    });

    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(() => document.querySelector('#stadium-select option[value="大村"]')?.dataset?.available === 'true', null, { timeout: 5_000 });
    } catch {
      const state = await page.evaluate(() => ({ date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
        venue: document.querySelector('#stadium-select')?.options?.[1]?.outerHTML, status: document.querySelector('#prediction-status')?.textContent }));
      throw new Error(`initial availability unavailable; requested=${requestedDates.join(',')}; state=${JSON.stringify(state)}`);
    }
    const stadium = page.locator('#stadium-select');
    const race = page.locator('#race-select');
    const start = page.locator('#start-btn');
    await stadium.selectOption('大村');
    await race.selectOption('12R');
    assert.equal(await start.isDisabled(), false, 'race before its deadline should remain selectable');

    await page.clock.fastForward(65_000);
    await page.waitForFunction(() => document.querySelector('#race-select')?.value === '');
    assert.equal(await start.isDisabled(), true, 'race must become unselectable after its deadline');
    assert.match(await page.locator('#prediction-status').textContent(), /締切/);

    await page.clock.fastForward(70_000);
    await page.waitForFunction(() => document.querySelector('#stadium-select option[value="大村"]')?.dataset?.available === 'false');
    assert.equal(await stadium.inputValue(), '', 'closed venue selection must be cleared');
    assert.equal(await start.isDisabled(), true);

    const rolloverFetch = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/functions/v1/predictions') && url.searchParams.get('raceDate') === '2026-09-28';
    });
    // Run timers through the interval instead of skipping over them, so both
    // the midnight refresh and the five-minute scheduled refresh can fire
    // without advancing beyond the synthetic race's deadline.
    await page.clock.runFor(180_000);
    await rolloverFetch;
    assert.ok(requestedDates.includes('2026-09-28'), `date rollover must refresh availability; received ${requestedDates.join(',')}`);
    assert.ok(requestedDates.filter((date) => date === '2026-09-28').length >= 2,
      `five-minute scheduled refresh must fetch the current JST date again; received ${requestedDates.join(',')}`);
    assert.equal(await start.isDisabled(), true, 'no prior-day race may remain selectable after date rollover');
    await stadium.selectOption('大村');
    await race.selectOption('1R');
    assert.equal(await start.isDisabled(), false, 'new-day race should be selectable before its deadline');
    await start.click();
    await page.getByRole('status').filter({ hasText: 'レース解析中…' }).waitFor({ timeout: 5_000 });
    await page.clock.fastForward(105_000);
    await page.waitForFunction(() => document.querySelector('#race-select')?.value === '');
    const finalStatus = await page.locator('#prediction-status').textContent();
    assert.match(finalStatus, /締切/);
    assert.doesNotMatch(finalStatus, /もう一度|再試行/);
    await page.clock.fastForward(3_000);
    assert.equal(await start.isDisabled(), true, 'START must stay disabled after the selected race closes');
    console.log('PASS: U04 local mock verified deadline closure, selection clearing, JST rollover fetch, and scheduled refresh');
    console.log('PASS: U06 active run crossing the deadline ends with a closed notice and no retry prompt');
    console.log('INFO: virtual clock and synthetic API only; no Supabase, Gemini, hosted service, or public URL used');
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
})().catch((error) => { console.error(`${error.name || 'Error'}: ${error.message || 'date-refresh smoke failed'}`); process.exitCode = 1; });
