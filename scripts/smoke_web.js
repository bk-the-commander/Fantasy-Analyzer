/* Headless smoke test for the web app: walks every view, fails on any console
 * error or page exception, and writes screenshots for visual review.
 * Usage: node scripts/smoke_web.js [baseUrl] [outDir] */
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:8811';
const OUT = process.argv[3] || '/tmp/shots';

const ROUTES = [
  ['home',         '#/player'],
  ['player-bonds', '#/player/1715'],
  ['player-season','#/player/1715?season=2001'],
  ['player-ohtani','#/player/13838'],
  ['player-rivera','#/player/15720'],
  ['career',       '#/career'],
  ['season',       '#/season'],
  ['year',         '#/year/1998'],
  ['compare',      '#/compare/1715,16250,8064'],
  ['scoring',      '#/scoring'],
];

(async () => {
  // The sandbox ships a pinned Chromium that may not match this Playwright
  // build's expected revision; point at it explicitly rather than downloading.
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  for (const [name, hash] of ROUTES) {
    errors.length = 0;
    await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const text = await page.evaluate(() => document.querySelector('#app').innerText.slice(0, 160));
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
    const status = errors.length ? `FAIL ${errors.join(' | ')}` : 'ok';
    console.log(`${name.padEnd(15)} ${status}\n   ${text.replace(/\n+/g, ' / ').slice(0, 130)}`);
  }

  // interaction checks
  errors.length = 0;
  await page.goto(`${BASE}/#/player`, { waitUntil: 'networkidle' });
  await page.fill('#globalSearch', 'griffey');
  await page.waitForTimeout(400);
  const hits = await page.$$eval('.sr-item .sr-name', (n) => n.map((x) => x.textContent));
  console.log('search "griffey" ->', hits.join(' | ') || 'NO RESULTS');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  console.log('after Enter ->', page.url().split('#')[1],
              (await page.$eval('.ph-name', (n) => n.textContent)));
  await page.screenshot({ path: `${OUT}/search-nav.png` });

  await page.goto(`${BASE}/#/season`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.click('.seg button:nth-child(2)');           // switch to pitching
  await page.waitForTimeout(900);
  const firstPit = await page.$eval('table.stats tbody tr', (r) => r.innerText.replace(/\t/g, ' | '));
  console.log('season pitching row1:', firstPit);
  await page.selectOption('.filters select', { label: 'Modern' });
  await page.waitForTimeout(700);
  const modern = await page.$eval('table.stats tbody tr', (r) => r.innerText.replace(/\t/g, ' | '));
  console.log('modern-era row1:', modern);
  await page.screenshot({ path: `${OUT}/season-modern.png` });
  if (errors.length) console.log('INTERACTION ERRORS:', errors.join(' | '));

  await browser.close();
})();
