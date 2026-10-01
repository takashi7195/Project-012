// Mobile WebKit viewport regression check for the native race selector.
// All database/provider traffic is mocked; this uses the repository's local UI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { webkit } = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '../..');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(data);
  });
});

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const bundle = { status: 'success', mode: 'ai_bundle', contractVersion: 'ai-bundle-v1', snapshotId: '55555555-5555-4555-8555-555555555555', main: [1, 3, 2], counter: [2, 4, 1], hole: [6, 5, 4], narrative: 'WebKit viewport confirmation.' };

(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let browser;
  try {
    browser = await webkit.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === `http://127.0.0.1:${server.address().port}`) { await route.continue(); return; }
      if (url.pathname.endsWith('/functions/v1/predictions')) {
        const body = route.request().method() === 'GET'
          ? { predictionMode: 'ai_bundle', predictionContractVersion: 'ai-bundle-v1', raceDate: today, stadiums: [{ stadiumCode: 24, hasRaces: true, races: [9, 12].map(raceNumber => ({ raceNumber, closedAt: new Date(Date.now() + 3_600_000).toISOString() })) }] }
          : bundle;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        return;
      }
      if (url.pathname.endsWith('/functions/v1/comments')) { await route.fulfill({ status: 200, contentType: 'application/json', body: '{"comments":[]}' }); return; }
      await route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.waitForFunction(() => !document.querySelector('#stadium-select').disabled);
    const measure = stage => page.evaluate(stage => {
      const race = document.querySelector('#race-select').getBoundingClientRect();
      const stack = document.querySelector('.site-stack').getBoundingClientRect();
      return { stage, width: document.documentElement.scrollWidth, viewport: innerWidth, scale: visualViewport.scale,
        offsetLeft: visualViewport.offsetLeft, stackLeft: stack.left, raceWidth: race.width,
        raceLabel: document.querySelector('#race-selected-label').textContent };
    }, stage);
    const before = await measure('initial');
    await page.locator('#stadium-select').selectOption('大村');
    const venue = await measure('venue');
    await page.locator('#race-select').focus();
    await page.locator('#race-select').selectOption('9R');
    const selected = await measure('selected');
    assert.equal(await page.locator('#race-select option:checked').textContent().then(v => /^9R　\d{2}:\d{2} 締切予定$/.test(v)), true);
    assert.equal(selected.raceLabel, '9R');
    await page.locator('#start-btn').tap();
    const starting = await measure('start');
    const series = [before, venue, selected, starting];
    for (const item of series) {
      assert.equal(item.width, item.viewport, `${item.stage}: document must not grow beyond mobile viewport: ${JSON.stringify(item)}`);
      assert.equal(item.scale, 1, `${item.stage}: viewport scale changed: ${JSON.stringify(item)}`);
      assert.equal(item.offsetLeft, 0, `${item.stage}: viewport shifted horizontally: ${JSON.stringify(item)}`);
    }
    await page.waitForFunction(() => document.querySelector('#race-development-text')?.textContent === 'WebKit viewport confirmation.', null, { timeout: 30_000 });
    const completed = await measure('completed');
    assert.equal(completed.width, completed.viewport);
    assert.equal(completed.raceLabel, '9R');
    assert.ok(Math.abs(selected.raceWidth - before.raceWidth) <= 1, 'race selector width must remain fixed');
    assert.equal(completed.stackLeft, before.stackLeft, 'main content should stay centered');
    console.log(`PASS: mobile WebKit 375x812 DPR3; widths ${[before, venue, selected, starting, completed].map(x => `${x.stage}=${x.width}/${x.viewport}`).join(', ')}`);
    console.log('PASS: closed label stayed 9R, native option retained deadline, width and center stayed stable through START and result');
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
})().catch(error => { console.error(`${error.name || 'Error'}: ${error.message || 'mobile WebKit viewport test failed'}`); process.exitCode = 1; });
