// Local-only Playwright UI smoke. All Supabase/other internet requests are
// intercepted; the test uses deterministic mock availability and predictions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '../..');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
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
const bundle = { status: 'success', mode: 'ai_bundle', contractVersion: 'ai-bundle-v1', snapshotId: '55555555-5555-4555-8555-555555555555',
  main: [1,3,2], counter: [2,4,1], hole: [6,5,4], narrative: '<img src=x onerror=alert(1)>\n' + 'レース展開の画面確認用文章です。'.repeat(90) + '\n\n終盤の確認用文章です。'.repeat(90) };
let reads = 0;
let starts = 0;

function listen() { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); }); }

(async () => {
  const port = await listen();
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === `http://127.0.0.1:${port}`) { await route.continue(); return; }
      if (url.pathname.endsWith('/functions/v1/predictions')) {
        if (route.request().method() === 'GET' && url.searchParams.get('action') === 'races') {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ predictionMode: 'ai_bundle', predictionContractVersion: 'ai-bundle-v1', raceDate: today,
            stadiums: [{ stadiumCode: 24, hasRaces: true, races: [{ raceNumber: 12, closedAt: new Date(Date.now() + 60 * 60_000).toISOString() }] }] }) });
          return;
        }
        if (route.request().method() === 'POST') {
          starts++;
          if (starts === 1) {
            reads = 0;
            await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ status: 'generating', mode: 'ai_bundle', contractVersion: 'ai-bundle-v1',
              jobId: '66666666-6666-4666-8666-666666666666', remainingMs: 60_000, retryAfterMs: 100 }) });
          } else if (starts === 2) {
            await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ status: 'failed', retryable: true, mode: 'ai_bundle', contractVersion: 'ai-bundle-v1' }) });
          } else if (starts === 3) {
            await route.abort('failed');
          } else if (starts === 4) {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...bundle, main: [1, 1, 2] }) });
          } else {
            await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ status: 'failed', retryable: true, errorCode: 'save_failed' }) });
          }
          return;
        }
        if (route.request().method() === 'GET' && url.searchParams.get('action') === 'prediction-job') {
          reads++;
          if (reads === 1) await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ status: 'generating', mode: 'ai_bundle', contractVersion: 'ai-bundle-v1', jobId: '66666666-6666-4666-8666-666666666666', remainingMs: 60_000, retryAfterMs: 100 }) });
          else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bundle) });
          return;
        }
      }
      // Comments and all other non-local traffic are stubbed or rejected.
      if (url.pathname.endsWith('/functions/v1/comments') && route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ comments: [] }) });
      } else {
        await route.abort('blockedbyclient');
      }
    });

    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    const stadium = page.locator('#stadium-select');
    const race = page.locator('#race-select');
    const start = page.locator('#start-btn');
    assert.equal(await page.locator('#race-development-text').textContent(), '', 'the initial page must not show a sample race narrative');
    assert.equal(await page.locator('.title-avatar').evaluate((image) => image.complete && image.naturalWidth > 0), true, 'AI Takashi avatar should load next to the title');
    await page.waitForFunction(() => window.__testNoop || document.querySelector('#stadium-select')?.options?.[1]?.dataset?.available !== undefined);
    assert.equal(await start.isDisabled(), true, 'START must remain disabled until both selectors are chosen');
    await stadium.selectOption('大村');
    await race.selectOption('12R');
    assert.equal(await start.isDisabled(), false, 'open race should enable START');
    assert.match(await race.locator('option:checked').textContent(), /^12R　\d{2}:\d{2} 締切予定$/, 'native picker must retain deadline text');
    assert.equal(await page.locator('#race-selected-label').innerText(), '12R');
    await race.click();
    await page.keyboard.press('Escape');
    assert.equal(await race.inputValue(), '12R', 'cancelling native picker preserves selection');
    assert.equal(await page.locator('#race-selected-label').innerText(), '12R');
    await race.selectOption('');
    assert.equal(await page.locator('#race-selected-label').innerText(), 'レース');
    await race.focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await race.inputValue(), '12R', 'native keyboard selection should remain available');
    assert.match(await race.locator('option:checked').textContent(), /^12R　\d{2}:\d{2} 締切予定$/);
    assert.equal(await page.locator('#race-selected-label').innerText(), '12R', 'keyboard selection syncs short label');
    await race.selectOption('12R');

    await start.click();
    await page.getByRole('status').filter({ hasText: 'レース解析中…' }).waitFor({ timeout: 5_000 });
    assert.equal(await stadium.isDisabled(), true);
    assert.equal(await race.isDisabled(), true);
    try {
      await page.waitForFunction(() => document.querySelector('#race-development-text')?.textContent?.startsWith('<img src=x'), null, { timeout: 40_000 });
    } catch {
      const state = await page.evaluate(() => ({ status: document.querySelector('#prediction-status')?.textContent || '', narrativePresent: Boolean(document.querySelector('#race-development-text')?.textContent),
        mainVisible: document.querySelector('#slot-1 .reel')?.textContent || '', startDisabled: document.querySelector('#start-btn')?.disabled }));
      throw new Error(`result timeout; starts=${starts}, reads=${reads}, status=${state.status || 'empty'}, narrativePresent=${state.narrativePresent}, mainDigitsPresent=${Boolean(state.mainVisible)}, startDisabled=${state.startDisabled}`);
    }
    assert.equal(await page.locator('#race-development-text').textContent(), bundle.narrative);
    assert.equal(await page.locator('#race-development-text img, #race-development-text script').count(), 0, 'narrative markup must render as text');
    assert.ok((await page.locator('#race-development-text').innerText()).includes('\n'), 'narrative line breaks must remain visible');
    assert.doesNotMatch(await page.locator('.game-panel, .secondary-predictions, .race-development').allInnerTexts().then(parts => parts.join('\n')), /fetchedAt|取得時刻|モデル名|Gemini/i,
      'prediction display must not add source timestamps or model details');
    assert.equal((await page.locator('[data-prediction="counter"]').textContent()).replace(/\s+/g, ''), '2-4-1');
    assert.equal((await page.locator('[data-prediction="longshot"]').textContent()).replace(/\s+/g, ''), '6-5-4');
    assert.equal(await page.locator('#prediction-status').textContent(), '');
    assert.equal(await start.isDisabled(), false);
    assert.equal(starts, 1);
    assert.ok(reads >= 2, 'pending job must be polled before the result appears');

    for (const [expectedStart, failureKind] of [[2, 'provider HTTP failure'], [3, 'network disconnect'], [4, 'invalid bundle'], [5, 'save failure']]) {
      await start.click();
      await page.locator('#prediction-status').getByText('予想を生成できませんでした。もう一度お試しください。').waitFor({ timeout: 5_000 });
      assert.equal(starts, expectedStart, `${failureKind} should use its own request`);
      assert.equal((await page.locator('[data-prediction="counter"]').textContent()).trim(), '—', `${failureKind} must clear counter`);
      assert.equal((await page.locator('[data-prediction="longshot"]').textContent()).trim(), '—', `${failureKind} must clear longshot`);
      assert.equal(await page.locator('#race-development-text').textContent(), '', `${failureKind} must clear narrative`);
      assert.equal(await start.isDisabled(), false, `${failureKind} must restore START`);
      await page.waitForTimeout(1600); // allow the idle reel's CSS transition to settle
      const idleBoats = await page.evaluate(() => [1, 2, 3].map(number => {
        const slot = document.querySelector(`#slot-${number}`);
        const center = slot.getBoundingClientRect().top + slot.getBoundingClientRect().height / 2;
        const item = [...slot.querySelectorAll('.item')].sort((a, b) => {
          const rectA = a.getBoundingClientRect(), rectB = b.getBoundingClientRect();
          return Math.abs(rectA.top + rectA.height / 2 - center) - Math.abs(rectB.top + rectB.height / 2 - center);
        })[0];
        return Number(item?.textContent);
      }));
      assert.deepEqual(idleBoats, [1, 2, 3], `${failureKind} must restore idle 1-2-3; got ${JSON.stringify(idleBoats)}`);
    }

    for (const width of [320, 375, 390, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      const geometry = await page.evaluate(() => {
        const frame = (selector) => { const rect = document.querySelector(selector).getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width }; };
        const race = document.querySelector('#race-select');
        const avatar = document.querySelector('.title-avatar').getBoundingClientRect();
        return { scrollWidth: document.documentElement.scrollWidth, roulette: frame('.game-panel'), comments: frame('.comments-section'),
          raceText: race.selectedOptions[0]?.textContent,
          shortText: document.querySelector('#race-selected-label').textContent,
          raceFrame: frame('.race-select-shell'), stadiumFrame: frame('#stadium-select'),
          selectorStyle: { width: document.styleSheets.length && getComputedStyle(document.querySelector('.selectors')).maxWidth },
          shortFrame: frame('#race-selected-label'), shortScroll: document.querySelector('#race-selected-label').scrollWidth,
          nativeColor: getComputedStyle(race).color, optionColor: getComputedStyle(race.selectedOptions[0]).color,
          avatarWidth: avatar.width, title: document.querySelector('#site-title').getBoundingClientRect(), viewport: innerWidth };
      });
      assert.ok(geometry.scrollWidth <= width + 1, `horizontal overflow at ${width}px`);
      assert.ok(Math.abs(geometry.roulette.left - geometry.comments.left) <= 1 && Math.abs(geometry.roulette.right - geometry.comments.right) <= 1,
        `white panel edges differ at ${width}px: ${JSON.stringify(geometry)}`);
      assert.match(geometry.raceText, /^12R　\d{2}:\d{2} 締切予定$/, `race label should match the original format at ${width}px`);
      assert.equal(geometry.shortText, '12R');
      assert.equal(geometry.nativeColor, 'rgba(0, 0, 0, 0)');
      assert.notEqual(geometry.optionColor, 'rgba(0, 0, 0, 0)');
      assert.ok(Math.abs(geometry.raceFrame.width - geometry.stadiumFrame.width) <= 1, 'selector widths stay equal');
      assert.equal(geometry.selectorStyle.width, '280px');
      assert.ok(geometry.shortScroll <= geometry.shortFrame.width + 1, 'short race number fits without clipping');
      assert.ok(geometry.avatarWidth >= (width >= 768 ? 80 : 64), `avatar should remain recognizable at ${width}px`);
      assert.ok(geometry.title.left >= 0 && geometry.title.right <= geometry.viewport + 1, `title/avatar exceed viewport at ${width}px`);
    }
    await context.close();
    const noJs = await browser.newContext({ javaScriptEnabled: false });
    await noJs.route('**/*', route => new URL(route.request().url()).origin === `http://127.0.0.1:${port}` ? route.continue() : route.abort());
    const noJsPage = await noJs.newPage();
    await noJsPage.goto(`http://127.0.0.1:${port}/index.html`);
    assert.equal(await noJsPage.locator('#race-selected-label').isVisible(), false, 'without JS the short overlay stays hidden');
    assert.equal(await noJsPage.locator('#race-select').isVisible(), true);
    assert.notEqual(await noJsPage.locator('#race-select').evaluate(el => getComputedStyle(el).color), 'rgba(0, 0, 0, 0)');
    assert.equal(await noJsPage.locator('#race-development-text').textContent(), '');
    await noJs.close();
    assert.ok(bundle.narrative.length > 1000, 'fixture narrative must exceed 1000 characters');
    console.log('PASS: Playwright/Edge local UI selection, START/poll/success, secondary bundle, >1000-character multiline narrative, and four failure paths with result clearing');
    console.log('PASS: layouts 320/375/390/430/768/1280px; compact race label and native full option format and roulette/comments white frame alignment verified');
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
})().catch((error) => {
  console.error(`${error.name || 'Error'}: ${error.message || 'local UI smoke failed'}`);
  process.exitCode = 1;
});
