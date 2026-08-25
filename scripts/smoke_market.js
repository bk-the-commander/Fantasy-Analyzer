#!/usr/bin/env node
/* Drives the market terminal in a real browser and fails on anything broken.
 *
 * This is the check that matters for a no-build front end: there is no
 * compiler to catch a typo, so the guard is loading every route, watching the
 * console, and asserting the things that should be on screen actually are.
 *
 *   node scripts/smoke_market.js [--shots DIR]
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'web');
const PORT = 8823;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      let file = path.join(ROOT, url);
      if (url.endsWith('/')) file = path.join(file, 'index.html');
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      fs.readFile(file, (err, body) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        res.end(body);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

const shotsFlag = process.argv.indexOf('--shots');
const SHOTS = shotsFlag > -1 ? process.argv[shotsFlag + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${message}`);
}

(async () => {
  const server = await serve();
  // The image ships a pinned Chromium that may not match this Playwright
  // build's expected revision, so prefer the one that is actually on disk.
  const bundled = ['/opt/pw-browsers/chromium/chrome-linux/chrome',
                   '/opt/pw-browsers/chromium-1194/chrome-linux/chrome']
    .find((candidate) => fs.existsSync(candidate));
  const browser = await chromium.launch(bundled ? { executablePath: bundled } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  const base = `http://127.0.0.1:${PORT}/market/`;
  const go = async (hash, wait) => {
    await page.goto(base + hash, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 15000 });
    if (wait) await page.waitForSelector(wait, { timeout: 15000 });
    await page.waitForTimeout(450);
  };
  const shot = async (name) => {
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
  };

  console.log('\n— overview');
  await go('#/', '.stat');
  check(await page.locator('.stat').count() >= 5, 'overview renders stat tiles');
  check(await page.locator('.tape-item').count() > 0, 'index tape renders');
  check(await page.locator('.heat-tile').count() > 20, 'overview heatmap renders tiles');
  check(await page.locator('.news-item').count() > 0, 'overview shows headlines');
  check(!(await page.locator('#banner').isHidden()), 'demo banner is visible for demo data');
  await shot('01-overview');

  console.log('\n— screener');
  await go('#/screener', 'table.data tbody tr');
  const firstRows = await page.locator('table.data tbody tr').count();
  check(firstRows > 10, `screener lists rows (${firstRows})`);
  check(await page.locator('thead th').count() >= 8, 'screener renders the preset columns');
  await shot('02-screener');

  // sorting
  await page.locator('thead th', { hasText: 'Change' }).first().click();
  await page.waitForTimeout(250);
  const changes = await page.evaluate(() => {
    const headers = [...document.querySelectorAll('thead th')].map((th) => th.textContent.trim().replace(/[▲▼]/g, ''));
    const index = headers.indexOf('Change');
    return [...document.querySelectorAll('table.data tbody tr')].slice(0, 8)
      .map((row) => parseFloat(row.children[index].textContent.replace('−', '-').replace(/[+%]/g, '')));
  });
  const sortedDesc = changes.every((value, i) => i === 0 || Number.isNaN(value) || changes[i - 1] >= value);
  check(sortedDesc, `clicking Change sorts descending (${changes.slice(0, 4).join(', ')})`);

  // filtering
  await go('#/screener?view=technical&rsi=overbought&sort=-rsi', 'table.data tbody tr');
  const rsis = await page.evaluate(() => {
    const headers = [...document.querySelectorAll('thead th')].map((th) => th.textContent.trim().replace(/[▲▼]/g, ''));
    const index = headers.indexOf('RSI');
    return [...document.querySelectorAll('table.data tbody tr')]
      .map((row) => parseFloat(row.children[index].textContent));
  });
  check(rsis.length > 0 && rsis.every((value) => value >= 70), `RSI filter keeps only overbought rows (${rsis.length} rows)`);
  check(await page.locator('.chip').count() > 0, 'active filter renders a chip');
  await shot('03-screener-filtered');

  console.log('\n— heatmap');
  await go('#/heatmap', '.heat-tile');
  const tiles = await page.locator('.heat-tile').count();
  check(tiles > 60, `heatmap renders tiles (${tiles})`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 1, `no horizontal page overflow (${overflow}px)`);
  await shot('04-heatmap');

  console.log('\n— groups');
  await go('#/groups', 'table.data tbody tr');
  check(await page.locator('table.data').count() === 2, 'groups renders sector and industry tables');
  await shot('05-groups');

  console.log('\n— news & insider');
  await go('#/news', '.news-item');
  check(await page.locator('.news-item').count() > 5, 'news page lists stories');
  await go('#/insider', 'table.data tbody tr');
  check(await page.locator('table.data tbody tr').count() > 5, 'insider page lists filings');
  await shot('06-insider');

  console.log('\n— ticker detail');
  // Pick a real company, not a fund: an ETF legitimately has no P/E or margins,
  // so it is the wrong row to assert a fundamentals grid against.
  const { symbol, fund } = await page.evaluate(async () => {
    const rows = await (await fetch('data/screener.json')).json();
    return {
      symbol: (rows.find((row) => row.quote_type !== 'ETF' && row.pe) || rows[0]).symbol,
      fund: (rows.find((row) => row.quote_type === 'ETF') || {}).symbol,
    };
  });
  await go(`#/t/${symbol}`, '.chart-shell canvas');
  check(await page.locator('.chart-shell canvas').count() === 1, 'price chart canvas is present');
  check(await page.locator('.chart-legend span').count() >= 2, 'chart legend direct-labels the averages');
  check(await page.locator('.kv-row').count() > 12, 'fundamentals grid is populated');
  const painted = await page.evaluate(() => {
    const canvas = document.querySelector('.chart-shell canvas');
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 8) lit += 1;
    return lit;
  });
  check(painted > 4000, `chart actually drew pixels (${painted} non-transparent)`);
  await shot('07-ticker');

  // crosshair tooltip
  const box = await page.locator('.chart-shell canvas').boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4);
  await page.waitForTimeout(220);
  check(await page.locator('.chart-tooltip:not([hidden])').count() === 1, 'crosshair tooltip appears on hover');
  await shot('08-ticker-hover');

  if (fund) {
    await go(`#/t/${fund}`, '.chart-shell canvas');
    check(await page.locator('.kv-row').count() > 4, `an ETF page renders without fundamentals (${fund})`);
    check(await page.locator('.chart-shell canvas').count() === 1, 'ETF page still charts');
  }

  console.log('\n— watchlist, search, themes');
  await go('#/screener', 'table.data tbody tr');
  await page.locator('.star').first().click();
  await page.waitForTimeout(150);
  const starred = await page.evaluate(() => JSON.parse(localStorage.getItem('kaliris.markets.v1')).watchlist);
  check(starred.length === 1, `starring a ticker persists it (${starred.join(',')})`);

  await page.fill('#search', starred[0].slice(0, 2));
  await page.waitForTimeout(300);
  check(await page.locator('#search-results li').count() > 0, 'search returns suggestions');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  check(page.url().includes('#/t/'), 'pressing Enter opens the highlighted result');

  await go('#/', '.stat');
  await page.click('#theme-toggle');
  await page.waitForTimeout(350);
  const theme = await page.getAttribute('html', 'data-theme');
  check(theme === 'light' || theme === 'dark', `theme toggle sets an explicit theme (${theme})`);
  await shot('09-light-theme');

  await page.click('#cvd-toggle');
  await page.waitForTimeout(350);
  check(await page.getAttribute('html', 'data-cvd') === 'safe', 'colourblind-safe palette engages');
  await go('#/heatmap', '.heat-tile');
  await shot('10-heatmap-cvd');

  console.log('\n— mobile');
  await page.setViewportSize({ width: 390, height: 844 });
  await go('#/screener', 'table.data tbody tr');
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(mobileOverflow <= 1, `no page-level horizontal scroll on mobile (${mobileOverflow}px)`);
  await shot('11-mobile');

  console.log('\n— console');
  check(consoleErrors.length === 0, `no console errors (${consoleErrors.length})`);
  for (const error of consoleErrors.slice(0, 8)) console.log(`        ${error}`);

  await browser.close();
  server.close();

  console.log(`\n${failures.length ? `${failures.length} FAILURE(S)` : 'all checks passed'}`);
  process.exit(failures.length ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
