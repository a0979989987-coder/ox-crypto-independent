const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const origin = 'https://ox-crypto-screener.vercel.app';
const repo = 'a0979989987-coder/ox-crypto-screener';
const commit = process.env.GITHUB_SHA;
const out = path.resolve('production-news-qa');
fs.mkdirSync(out, { recursive: true });
const proofImages = [];
const report = { commit, origin, mode: 'real production, fresh guest browser, no news fixtures', checks: [], viewports: [], screenshots: [], errors: [] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function github(url) {
  assert(url.startsWith('https://api.github.com/repos/' + repo + '/'));
  const response = await fetch(url, { headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('GitHub metadata HTTP ' + response.status);
  return response.json();
}
async function ready() {
  const files = ['src/components/news/center.js', 'src/components/news/workspace.js', 'src/components/news/model.js', 'src/styles/components/news-center.css'];
  for (let attempt = 0; attempt < 30; attempt++) {
    const deployments = await github('https://api.github.com/repos/' + repo + '/deployments?sha=' + commit + '&per_page=5');
    const production = deployments.find(item => item.environment === 'Production');
    if (production) {
      const statuses = await github(production.statuses_url);
      if (statuses[0]?.state === 'failure' || statuses[0]?.state === 'error') throw new Error('Vercel production deployment failed');
      if (statuses[0]?.state === 'success') {
        const results = await Promise.all(files.map(async file => {
          const response = await fetch(origin + '/' + file + '?news-release=' + commit, { signal: AbortSignal.timeout(20000) });
          return response.ok && Buffer.from(await response.arrayBuffer()).equals(fs.readFileSync(file));
        }));
        if (results.every(Boolean)) {
          report.deployment = { id: production.id, environment: production.environment, state: statuses[0].state, url: statuses[0].environment_url, createdAt: statuses[0].created_at };
          report.checks.push('Production environment success and public alias serves exact committed news JS/CSS');
          return;
        }
      }
    }
    await delay(10000);
  }
  throw new Error('Production deployment or public alias did not become ready within 5 minutes');
}
async function snapshot(page, name) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(out, name) });
  report.screenshots.push(name);
  if (name === 'calendar-1440x900.png' || name === 'key-news-390x844.png') {
    const jpeg = await page.screenshot({type:'jpeg',quality:85});
    const id = name === 'calendar-1440x900.png' ? 'production-desktop-calendar.jpg' : 'production-mobile-key-news.jpg';
    fs.writeFileSync(path.join(out,id),jpeg);
    const sha = crypto.createHash('sha1').update(Buffer.from('blob ' + jpeg.length)).update(Buffer.from([0])).update(jpeg).digest('hex');
    proofImages.push({id,sha,data:jpeg.toString('base64')});
  }
}
(async () => {
  await ready();
  const response = await fetch(origin + '/data/news.json?news-release=' + commit, { signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.schemaVersion, 1); assert(Array.isArray(data.news) && data.news.length > 0); assert(Array.isArray(data.events) && data.events.length > 0);
  report.snapshot = { generatedAt: data.generatedAt, news: data.news.length, events: data.events.length };
  const browser = await chromium.launch({ headless: true });
  try {
    for (const size of [{width:1440,height:900},{width:1366,height:768},{width:390,height:844},{width:375,height:667},{width:430,height:932}]) {
      const context = await browser.newContext({ viewport: size, isMobile: size.width < 600, hasTouch: size.width < 600 });
      // This preference applies only to this fresh QA context, never a user's signed-in browser.
      await context.addInitScript(() => { if (window.top === window) { try { localStorage.setItem('ox-setting-oxLive', '1'); } catch {} } });
      const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
      await page.goto(origin + '/#news/crypto', { waitUntil: 'domcontentloaded', timeout: 40000 });
      await page.locator('.oxn-root[data-scope="crypto"] .oxn-calendar-grid').waitFor({ timeout: 25000 });
      assert.equal(await page.locator('.oxn-tabs [data-news-tab]').count(), 2);
      const bounds = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth-innerWidth, bottom: document.querySelector('.oxn-calendar').getBoundingClientRect().bottom, dockTop: document.querySelector('.app-dock').getBoundingClientRect().top }));
      assert(bounds.overflow <= 1);
      if (size.width < 600) assert(bounds.bottom < bounds.dockTop, 'complete mobile month above dock');
      await snapshot(page, 'calendar-' + size.width + 'x' + size.height + '.png');
      await page.locator('.oxn-tabs [data-news-tab="key"]').click();
      assert.equal(await page.locator('.oxn-controls .oxn-pill').count(), 4);
      assert(await page.locator('.oxn-news-row').count() > 0);
      await snapshot(page, 'key-news-' + size.width + 'x' + size.height + '.png');
      await page.getByRole('button',{name:'多選新聞來源',exact:true}).click();
      const panel = page.locator('.oxn-popover.is-open'); await panel.waitFor();
      assert.equal(await panel.locator('input[type="checkbox"]').count(), 0);
      const tags = panel.locator('.oxn-tag:not(:disabled)'); assert(await tags.count() >= 2);
      await tags.nth(0).click(); await tags.nth(1).click();
      assert.equal(await panel.locator('.oxn-tag[aria-pressed="true"]').count(), 2);
      await snapshot(page, 'source-multi-' + size.width + 'x' + size.height + '.png');
      await panel.getByRole('button',{name:'恢復預設',exact:true}).click();
      await panel.getByRole('button',{name:'關閉篩選',exact:true}).click();
      await panel.waitFor({state:'detached'});
      await page.locator('.oxn-tabs [data-news-tab="calendar"]').click();
      if(size.width<600){await page.locator('.oxn-day-count').first().click();await page.locator('.oxn-event-card').first().click();}else await page.locator('.oxn-calendar-event').first().click();
      await page.getByRole('dialog',{name:'事件詳情',exact:true}).waitFor();
      await snapshot(page, 'crypto-detail-' + size.width + 'x' + size.height + '.png');
      await page.getByRole('button',{name:'返回上一層',exact:true}).click();
      await page.getByRole('dialog',{name:'事件詳情',exact:true}).waitFor({state:'detached'});
      await page.evaluate(() => window.OXNews.openMarket({market:'tw'}));
      await page.locator('.oxn-root[data-scope="tw"] .oxn-calendar-grid').waitFor();
      if(size.width<600){const day=data.events.find(e=>e.markets?.includes('tw')&&e.category==='dividend-preview'&&e.date?.startsWith('2026-10'))?.date;assert(day);await page.locator(`[data-date="${day}"] .oxn-day-count`).click();await page.locator('.oxn-event-card').first().click();}else await page.locator('.oxn-calendar-event[data-category="dividend-preview"]').first().click();
      await page.getByRole('dialog',{name:'事件詳情',exact:true}).waitFor();
      await snapshot(page, 'tw-detail-' + size.width + 'x' + size.height + '.png');
      await page.getByRole('button',{name:'返回上一層',exact:true}).click();
      await page.getByRole('dialog',{name:'事件詳情',exact:true}).waitFor({state:'detached'});
      await page.evaluate(() => window.OXNews.open());
      await page.locator('.oxn-root[data-scope="all"] .oxn-calendar-grid').waitFor();
      await page.reload({waitUntil:'domcontentloaded'});
      await page.locator('.oxn-root[data-scope="all"] .oxn-calendar-grid').waitFor();
      assert.equal(await page.locator('.oxn-tabs [data-news-tab]').count(), 2);
      report.viewports.push({size,...bounds,passed:true});
      await context.close();
    }
    assert.deepEqual(report.errors, []);
    report.checks.push('All five desktop/mobile viewports, real news and event data, source multiselect, crypto/TW/all workspaces, modal cleanup and all-news reload');
    report.passed = true;
  } finally { await browser.close(); }
})().catch(error => { report.passed = false; report.failure = error.message; process.exitCode = 1; }).finally(() => {
  fs.writeFileSync(path.join(out,'report.json'), JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  for (const image of proofImages) {
    const count = Math.ceil(image.data.length / 12000);
    console.log('OX_NEWS_QA_JPEG_META ' + JSON.stringify({id:image.id,sha:image.sha,count}));
    for (let i=0;i<count;i++) console.log('OX_NEWS_QA_JPEG_CHUNK ' + image.id + ' ' + i + ' ' + image.data.slice(i*12000,(i+1)*12000));
  }
});
