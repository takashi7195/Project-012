// U09 local-only comments UI check. All non-loopback traffic is intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '../..');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((request, response) => {
  const file = path.resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)}`);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(data);
  });
});

const now = new Date();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const existingComment = { id: '11111111-1111-4111-8111-111111111111', nickname: '既存ユーザー', body: '<img src=x onerror=alert(1)>の表示確認', createdAt: now.toISOString(),
  reply: { author: 'AIタカシ', body: '展示情報を見ながら楽しみましょう。' }, tipRequested: false };
const postedComment = { id: '22222222-2222-4222-8222-222222222222', nickname: '試験ユーザー', body: '展示を確認しました。[メールアドレス]', createdAt: now.toISOString(),
  reply: { author: 'AIタカシ', body: 'コメントありがとうございます。レースを楽しみましょう。' }, tipRequested: false };
let postCount = 0;
let submittedBody;
let submittedNickname;

(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === `http://127.0.0.1:${server.address().port}`) { await route.continue(); return; }
      if (url.pathname.endsWith('/functions/v1/comments')) {
        if (route.request().method() === 'GET') {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ comments: [existingComment], nextCursor: null }) });
          return;
        }
        if (route.request().method() === 'POST') {
          postCount++;
          const payload = route.request().postDataJSON();
          submittedBody = payload.body;
          submittedNickname = payload.nickname;
          await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ comment: postedComment }) });
          return;
        }
      }
      if (url.pathname.endsWith('/functions/v1/predictions') && route.request().method() === 'GET' && url.searchParams.get('action') === 'races') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ predictionMode: 'ai_bundle', predictionContractVersion: 'ai-bundle-v1', raceDate: today,
          stadiums: [{ stadiumCode: 24, hasRaces: true, races: [{ raceNumber: 12, closedAt: new Date(Date.now() + 60 * 60_000).toISOString() }] }] }) });
        return;
      }
      await route.abort('blockedbyclient');
    });

    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.locator('.comment-card[data-comment-id="11111111-1111-4111-8111-111111111111"]').waitFor();
    assert.equal(await page.locator('#comments-list .comment-card').count(), 1);
    const existingCard = page.locator('.comment-card[data-comment-id="11111111-1111-4111-8111-111111111111"]');
    assert.equal(await existingCard.locator('.comment-text').textContent(), existingComment.body);
    assert.equal(await existingCard.locator('.comment-text img, .comment-text script').count(), 0, 'user comment markup must remain text');
    assert.equal(await existingCard.locator('.reply-label').textContent(), 'AIタカシ');
    assert.equal(await existingCard.locator('.reply-text').textContent(), existingComment.reply.body);

    await page.locator('#comment-open').click();
    assert.equal(await page.locator('#comment-composer').isVisible(), true);
    assert.equal(await page.locator('#comment').evaluate(element => document.activeElement === element), true, 'composer should focus the comment field');
    await page.locator('#nickname').fill('試験ユーザー');
    await page.locator('#comment').fill('展示を確認しました. test@example.com');
    assert.equal(await page.locator('#comment-count').textContent(), '27/300');
    await page.locator('#post-button').click();
    await page.locator('#comment-notice').getByText('コメントを投稿しました。').waitFor();
    assert.equal(postCount, 1, 'one submit should issue exactly one POST');
    assert.equal(submittedNickname, '試験ユーザー');
    assert.equal(submittedBody, '展示を確認しました. [メールアドレス]', 'PII normalization should happen before the request');

    const newCard = page.locator('.comment-card[data-comment-id="22222222-2222-4222-8222-222222222222"]');
    assert.equal(await page.locator('#comments-list .comment-card').count(), 2);
    assert.equal(await newCard.locator('.comment-text').textContent(), postedComment.body);
    assert.equal(await newCard.locator('.reply-label').textContent(), 'AIタカシ');
    assert.equal(await newCard.locator('.reply-text').textContent(), postedComment.reply.body);
    assert.equal(await page.locator('#comment-composer').isHidden(), true);
    assert.equal(await page.locator('#comment').inputValue(), '');
    assert.equal(await page.locator('#comment-count').textContent(), '0/300');

    for (const width of [320, 375, 390, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      const geometry = await page.evaluate(() => {
        const frame = (selector) => { const rect = document.querySelector(selector).getBoundingClientRect(); return { left: rect.left, right: rect.right }; };
        return { roulette: frame('.game-panel'), comments: frame('.comments-section'), scrollWidth: document.documentElement.scrollWidth, width: innerWidth,
          cards: [...document.querySelectorAll('.comment-card')].map(card => ({ left: card.getBoundingClientRect().left, right: card.getBoundingClientRect().right })) };
      });
      assert.ok(Math.abs(geometry.roulette.left - geometry.comments.left) <= 1 && Math.abs(geometry.roulette.right - geometry.comments.right) <= 1,
        `white panels should align with populated comments at ${width}px`);
      assert.ok(geometry.scrollWidth <= width + 1, `populated comments should not cause horizontal overflow at ${width}px`);
      assert.ok(geometry.cards.every(card => card.left >= geometry.comments.left && card.right <= geometry.comments.right), `comment cards should fit inside the frame at ${width}px`);
    }

    await page.locator('#stadium-select').selectOption('大村');
    await page.locator('#race-select').selectOption('12R');
    assert.equal(await page.locator('#start-btn').isDisabled(), false, 'comment interaction must not break prediction selection');
    assert.equal(await page.locator('#race-development-text').count(), 1, 'prediction content remains in the same page');
    assert.equal(postCount, 1);
    console.log('PASS: U09 local browser comment list, composer, PII normalization, POST/reply rendering and prediction UI coexistence');
    console.log('INFO: local static page + intercepted mock API only; no Supabase, Gemini, hosted service, or public URL used');
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
})().catch((error) => { console.error(`${error.name || 'Error'}: ${error.message || 'comments UI smoke failed'}`); process.exitCode = 1; });
