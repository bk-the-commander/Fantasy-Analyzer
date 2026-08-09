/* Headless smoke test for the web app: walks every view, fails on any console
 * error or page exception, and writes screenshots for visual review.
 * Usage: node scripts/smoke_web.js [baseUrl] [outDir] */
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:8811';
const OUT = process.argv[3] || '/tmp/shots';

const ROUTES = [
  ['home',         '#/player'],
  ['player-bonds', '#/player/bondsba01'],
  ['player-season','#/player/bondsba01?season=2001'],
  ['player-ohtani','#/player/ohtansh01'],
  ['player-rivera','#/player/riverma01'],
  ['player-cobb',  '#/player/cobbty01'],   // pre-1955: exercises the era footnote
  ['career',       '#/career'],
  ['season',       '#/season'],
  ['year',         '#/year/1998'],
  ['compare',      '#/compare/bondsba01,ruthba01,henderi01'],
  ['scoring',      '#/scoring'],
  ['about',        '#/about'],
  ['contact',      '#/contact'],
  ['privacy',      '#/privacy'],
  ['terms',        '#/terms'],
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

  // --- theme: auto-by-clock, plus the manual override cycle ---------------
  for (const [label, hour] of [['day', 13], ['night', 22]]) {
    const ctx = await browser.newContext({
      viewport: { width: 1500, height: 1000 },
      // Freeze the clock so "auto" is deterministic instead of depending on
      // whatever time the test happens to run at.
      timezoneId: 'UTC',
    });
    const tp = await ctx.newPage();
    await tp.addInitScript(`{
      const Real = Date;
      const fixed = new Real(Real.UTC(2026, 5, 15, ${hour}, 0, 0));
      globalThis.Date = class extends Real {
        constructor(...a) { return a.length ? new Real(...a) : new Real(fixed); }
        static now() { return fixed.getTime(); }
      };
    }`);
    await tp.goto(`${BASE}/#/player/bondsba01`, { waitUntil: 'networkidle' });
    await tp.waitForTimeout(600);
    const theme = await tp.evaluate(() => document.documentElement.dataset.theme);
    console.log(`auto theme @${hour}:00 -> ${theme} (expected ${label === 'day' ? 'light' : 'dark'})`);
    await tp.screenshot({ path: `${OUT}/theme-${label}.png` });
    await ctx.close();
  }

  errors.length = 0;
  await page.goto(`${BASE}/#/career`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const cycle = [];
  for (let i = 0; i < 3; i++) {
    await page.click('#themeToggle');
    await page.waitForTimeout(200);
    cycle.push(await page.evaluate(() =>
      `${localStorage.getItem('fa-theme')}=${document.documentElement.dataset.theme}`));
  }
  console.log('toggle cycle:', cycle.join(' -> '));
  await page.screenshot({ path: `${OUT}/career-light.png` });
  const marks = await page.$$eval('.watermark, .chart-mark', (n) => n.length);
  console.log('watermarks on career page:', marks);
  if (errors.length) console.log('THEME ERRORS:', errors.join(' | '));

  await browser.close();
})();
