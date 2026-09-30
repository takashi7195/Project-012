// Measures U02/U03 roulette timing in Microsoft Edge with all remote traffic
// intercepted. Fast and delayed responses share the same complete bundle.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '../..');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json' };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(data);
  });
});
const bundle = { status: 'success', mode: 'ai_bundle', contractVersion: 'ai-bundle-v1', snapshotId: '55555555-5555-4555-8555-555555555555',
  main: [1, 3, 2], counter: [2, 4, 1], hole: [6, 5, 4], narrative: 'U02/U03 timer measurement fixture.' };
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const listen = () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });

async function runScenario(port, slow) {
  let reads = 0;
  let posts = 0;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => {
      window.__rouletteEvents = [];
      const record = (kind, index) => window.__rouletteEvents.push({ kind, index, at: performance.now() });
      document.addEventListener('click', event => { if (event.target.closest?.('#start-btn')) { window.__startClicked = true; record('startClick', null); } }, true);
      const previous = [];
      const sample = () => {
        [...document.querySelectorAll('.slot[id^="slot-"]')].forEach((slot, index) => {
          const current = slot.classList.contains('spinning') ? 'spinning' : /\bbg-[1-6]\b/.test(slot.className) ? 'done' : 'stopping';
          if (previous[index] !== 'spinning' && current === 'spinning') record('spinStart', index);
          if (previous[index] === 'spinning' && current === 'stopping') record('stopStart', index);
          if (previous[index] === 'stopping' && current === 'done') record('stopFinish', index);
          previous[index] = current;
        });
        if (window.__startClicked && document.querySelector('#race-development-text')?.textContent === 'U02/U03 timer measurement fixture.' && !window.__narrativeSeen) { window.__narrativeSeen = true; record('narrativeVisible', null); }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === `http://127.0.0.1:${port}`) return route.continue();
      if (url.pathname.endsWith('/functions/v1/predictions')) {
        if (route.request().method() === 'GET' && url.searchParams.get('action') === 'races') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ predictionMode: 'ai_bundle', predictionContractVersion: 'ai-bundle-v1', raceDate: today,
            stadiums: [{ stadiumCode: 24, hasRaces: true, races: [{ raceNumber: 12, closedAt: new Date(Date.now() + 60 * 60_000).toISOString() }] }] }) });
        }
        if (route.request().method() === 'POST') {
          posts++;
          return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ status: 'generating', mode: 'ai_bundle', contractVersion: 'ai-bundle-v1',
            jobId: '66666666-6666-4666-8666-666666666666', remainingMs: 60_000, retryAfterMs: 100 }) });
        }
        if (route.request().method() === 'GET' && url.searchParams.get('action') === 'prediction-job') {
          reads++;
          if (reads === 1) return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ status: 'generating', mode: 'ai_bundle', contractVersion: 'ai-bundle-v1', jobId: '66666666-6666-4666-8666-666666666666', remainingMs: 60_000, retryAfterMs: 100 }) });
          if (slow) await pause(5500);
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bundle) });
        }
      }
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#stadium-select')?.options?.[1]?.dataset?.available !== undefined);
    await page.waitForTimeout(1600); // allow the initial CSS transform to settle before reading idle values
    const idleBoats = await page.evaluate(() => [1, 2, 3].map(number => {
      const slot = document.querySelector(`#slot-${number}`);
      const center = slot.getBoundingClientRect().top + slot.getBoundingClientRect().height / 2;
      const item = [...slot.querySelectorAll('.item')].sort((a, b) => {
        const rectA = a.getBoundingClientRect(), rectB = b.getBoundingClientRect();
        return Math.abs(rectA.top + rectA.height / 2 - center) - Math.abs(rectB.top + rectB.height / 2 - center);
      })[0];
      return Number(item?.textContent);
    }));
    const idleTracks = await page.locator('.slot[id^="slot-"] .reel').evaluateAll(nodes => nodes.map(node => ({ inline: node.style.transform, computed: getComputedStyle(node).transform })));
    assert.deepEqual(idleBoats, [1, 2, 3], `idle display must show 1-2-3; measured=${JSON.stringify(idleBoats)} tracks=${JSON.stringify(idleTracks)}`);
    await page.locator('#stadium-select').selectOption('大村');
    assert.equal(await page.locator('#start-btn').isDisabled(), true, 'race choice is required before START');
    assert.equal(posts, 0, 'venue selection must not send a generation POST');
    await page.locator('#race-select').selectOption('12R');
    const start = page.locator('#start-btn');
    assert.equal(await start.isDisabled(), false, 'valid open race must enable START');
    assert.equal(posts, 0, 'selecting an open race must not send a generation POST');
    await start.click();
    const clickAt = (await page.evaluate(() => window.__rouletteEvents.find(event => event.kind === 'startClick')?.at));
    assert.ok(Number.isFinite(clickAt), 'START click timestamp must be captured in the page');
    await page.waitForFunction(() => [...document.querySelectorAll('.slot')].length === 3 && [...document.querySelectorAll('.slot')].every(slot => slot.classList.contains('spinning')));
    const spinStarts = (await page.evaluate(() => window.__rouletteEvents)).filter(event => event.kind === 'spinStart');
    assert.equal(spinStarts.length, 3, 'all three reels must start spinning');
    const spinDelayMs = Math.max(...spinStarts.map(event => event.at - clickAt));
    assert.ok(spinDelayMs < 500, `all reels must begin spinning immediately after START; max delay ${Math.round(spinDelayMs)}ms`);
    await page.waitForFunction(() => document.querySelector('#race-development-text')?.textContent === 'U02/U03 timer measurement fixture.', null, { timeout: 30_000 });
    const events = await page.evaluate(() => window.__rouletteEvents);
    const starts = events.filter(event => event.kind === 'stopStart').sort((a, b) => a.at - b.at);
    assert.equal(events.filter(event => event.kind === 'spinStart').length, 3, 'all three reel start events must be observed');
    const finishes = events.filter(event => event.kind === 'stopFinish').sort((a, b) => a.at - b.at);
    const narrative = events.find(event => event.kind === 'narrativeVisible');
    assert.equal(starts.length, 3, 'each reel must have one measured stop start');
    assert.equal(finishes.length, 3, 'each reel must have one measured stop completion');
    assert.deepEqual(starts.map(event => event.index), [2, 1, 0], 'stop order must reveal third, second, first');
    assert.ok(starts[0].at - clickAt >= 2850, 'first reel must keep the 3-second minimum animation');
    const firstStopMs = starts[0].at - clickAt;
    assert.ok(firstStopMs < 40000, `first reel stop exceeded 40s: ${Math.round(firstStopMs)}ms (slow=${slow}, jobReads=${reads})`);
    assert.ok(Math.abs((starts[1].at - finishes[0].at) - 6000) <= 500, `second reel must start six seconds after the third-place reel finishes; measured ${Math.round(starts[1].at - finishes[0].at)}ms`);
    assert.ok(Math.abs((starts[2].at - finishes[1].at) - 9000) <= 500, `first-place reel must start nine seconds after the second-place reel finishes; measured ${Math.round(starts[2].at - finishes[1].at)}ms`);
    const lastStop = finishes.at(-1);
    const revealAfterFinalMs = narrative.at - lastStop.at;
    assert.ok(revealAfterFinalMs >= 450 && revealAfterFinalMs < 1500, `secondary predictions and narrative must wait about 500ms after the final reel stops; measured ${Math.round(revealAfterFinalMs)}ms`);
    assert.equal((await page.locator('[data-prediction="counter"]').textContent()).replace(/\s+/g, ''), '2-4-1');
    assert.equal((await page.locator('[data-prediction="longshot"]').textContent()).replace(/\s+/g, ''), '6-5-4');
    await context.close();
    return { slow, firstStopMs: Math.round(firstStopMs), afterStopMs: [Math.round(starts[1].at - finishes[0].at), Math.round(starts[2].at - finishes[1].at)], revealAfterFinalMs: Math.round(revealAfterFinalMs), reads, posts, idleBoats };
  } finally {
    if (browser) await browser.close();
  }
}

(async () => {
  const port = await listen();
  try {
    const fast = await runScenario(port, false);
    const slow = await runScenario(port, true);
    assert.ok(slow.firstStopMs - fast.firstStopMs >= 2500, `delayed response must defer the first stop; fast=${fast.firstStopMs}ms slow=${slow.firstStopMs}ms`);
    console.log(`PASS: fast result animation timings ${JSON.stringify(fast)}`);
    console.log(`PASS: delayed result animation timings ${JSON.stringify(slow)}`);
    console.log('PASS: U01 idle 1-2-3 display, selector readiness and zero generation POST before START');
    console.log('INFO: local mock browser only; Supabase, Gemini and comment traffic were intercepted');
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
})().catch(error => { console.error(`${error.name || 'Error'}: ${error.message || 'UI animation smoke failed'}`); process.exitCode = 1; });
