/* Deep audit of the site: role ordering, every interactive process, layout
 * integrity at phone and desktop widths, and contrast in both themes.
 * Fails loudly rather than printing screenshots for a human to squint at.
 *
 * Usage: node scripts/audit_web.js [baseUrl] */
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:8811';
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

const problems = [];
const fail = (area, msg) => problems.push(`${area}: ${msg}`);
const ok = (area, msg) => console.log(`  ok   ${area} — ${msg}`);

/** Every block that must never spill outside the viewport. */
async function layoutIssues(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    if (document.body.scrollWidth > vw + 1) out.push('body scrolls sideways');
    for (const el of document.querySelectorAll(
      '.tile,.rail,.panel,.view-head,.prose,.note,.cmp-card,.filters,.preview-banner')) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) {
        out.push(`${el.className.split(' ')[0]} overflows (right=${Math.round(r.right)} vw=${vw})`);
      }
    }
    for (const el of document.querySelectorAll('.tile-value,.rail-value,.badge')) {
      if (el.scrollWidth > el.clientWidth + 1) out.push(`clipped text: "${el.textContent.trim()}"`);
    }
    // Text rendered in its own background colour is invisible.
    for (const el of document.querySelectorAll('.tile-value,.plink,.panel-head h2,.prose p')) {
      const cs = getComputedStyle(el);
      if (cs.color === cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
        out.push(`invisible text on ${el.className}`);
      }
    }
    return [...new Set(out)];
  });
}

async function checkRoleOrder(page, path, label, expectFirst) {
  await page.goto(`${BASE}/#/player/${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const heads = await page.$$eval('.panel-head h2', (n) => n.map((x) => x.textContent));
  const summary = heads.find((h) => /LEAGUE POINTS|league points/i.test(h)) || heads[0] || '';
  const logs = heads.filter((h) => /season by season/i.test(h));
  const firstLog = logs[0] || '';
  const summaryOk = summary.toLowerCase().includes(expectFirst);
  const logOk = !firstLog || firstLog.toLowerCase().includes(expectFirst);
  if (!summaryOk) fail('role order', `${label}: summary led with "${summary}", expected ${expectFirst}`);
  if (!logOk) fail('role order', `${label}: first log was "${firstLog}", expected ${expectFirst}`);
  if (summaryOk && logOk) ok('role order', `${label} leads with ${expectFirst}`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });

  // ---------------------------------------------------------------- roles
  const desktop = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await desktop.newPage();
  page.on('pageerror', (e) => fail('js', e.message));
  page.on('console', (m) => {
    // A failed request to the live stats API is environmental, not a defect --
    // the browser logs every failed fetch and this sandbox cannot reach MLB.
    // The app is required to handle that, which is asserted separately below.
    const from = (m.location() && m.location().url) || '';
    if (from.includes('statsapi.mlb.com')) return;
    if (m.type() === 'error') fail('console', m.text());
  });

  console.log('\n— role ordering —');
  await checkRoleOrder(page, 'riverma01', 'Mariano Rivera (RP)', 'pitching');
  await checkRoleOrder(page, 'ryanno01', 'Nolan Ryan (SP)', 'pitching');
  await checkRoleOrder(page, 'johnsra05', 'Randy Johnson (SP)', 'pitching');
  await checkRoleOrder(page, 'bondsba01', 'Barry Bonds (OF)', 'batting');
  await checkRoleOrder(page, 'henderi01', 'Rickey Henderson (OF)', 'batting');
  await checkRoleOrder(page, 'ohtansh01', 'Shohei Ohtani (two-way)', 'batting');
  await checkRoleOrder(page, 'ruthba01', 'Babe Ruth (two-way)', 'batting');

  // --------------------------------------------------------- interactions
  console.log('\n— interactive processes —');

  await page.goto(`${BASE}/#/player`, { waitUntil: 'networkidle' });
  await page.fill('#globalSearch', 'mays');
  await page.waitForTimeout(400);
  const results = await page.$$eval('.sr-item', (n) => n.length);
  if (!results) fail('search', 'no results for "mays"');
  else ok('search', `${results} results for "mays"`);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  const landed = await page.$eval('.ph-name', (n) => n.textContent).catch(() => null);
  if (!landed) fail('search', 'keyboard selection did not open a player page');
  else ok('search', `keyboard nav opened ${landed}`);

  // A bare surname must find the player people mean by it. These are the cases
  // where a naive prefix score picks an obscure player whose *given* name
  // happens to start with the query.
  for (const [query, expected] of [['mays', 'Willie Mays'], ['ruth', 'Babe Ruth'],
                                   ['young', 'Cy Young'], ['bonds', 'Barry Bonds'],
                                   ['rivera', 'Mariano Rivera'], ['aaron', 'Hank Aaron']]) {
    await page.goto(`${BASE}/#/player`, { waitUntil: 'networkidle' });
    await page.fill('#globalSearch', query);
    await page.waitForTimeout(350);
    const top = await page.$eval('.sr-item .sr-name', (n) => n.textContent.replace(/★.*/, '').trim())
      .catch(() => null);
    if (top !== expected) fail('search', `"${query}" ranked "${top}" first, expected ${expected}`);
    else ok('search', `"${query}" -> ${top}`);
  }

  // season scope switch
  await page.goto(`${BASE}/#/player/bondsba01`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.selectOption('.scope-switch select', '2001');
  await page.waitForTimeout(800);
  const scoped = await page.$eval('.panel-head h2', (n) => n.textContent);
  if (!/2001/.test(scoped)) fail('scope', `season select did not switch (got "${scoped}")`);
  else ok('scope', 'season select switches the page');

  // chart click drills into a season
  await page.goto(`${BASE}/#/player/bondsba01`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.click('.bar');
  await page.waitForTimeout(800);
  if (!/season=/.test(page.url())) fail('chart', 'clicking a bar did not select a season');
  else ok('chart', 'bar click drills into a season');

  // table sorting
  await page.goto(`${BASE}/#/career`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  // Assert the sorted column is actually ordered, rather than that the leader
  // changed -- Bonds tops both points and home runs, so a leader-change check
  // reports a false failure on exactly the column you would reach for first.
  const sortCol = 11;   // SB on the career batting board
  await page.click(`table.stats th:nth-child(${sortCol})`);
  await page.waitForTimeout(700);
  const vals = await page.$$eval(`table.stats tbody tr td:nth-child(${sortCol})`,
    (n) => n.slice(0, 30).map((x) => Number(x.textContent.replace(/,/g, ''))));
  const descending = vals.every((v, i) => i === 0 || vals[i - 1] >= v);
  const leader = await page.$eval('table.stats tbody tr td:nth-child(2)', (n) => n.textContent.trim());
  if (!descending) fail('sort', `column not sorted descending: ${vals.slice(0, 6)}`);
  else ok('sort', `sort works (SB leader ${leader}, ${vals[0]})`);
  await page.click(`table.stats th:nth-child(${sortCol})`);
  await page.waitForTimeout(700);
  const asc = await page.$$eval(`table.stats tbody tr td:nth-child(${sortCol})`,
    (n) => n.slice(0, 30).map((x) => Number(x.textContent.replace(/,/g, ''))));
  if (!asc.every((v, i) => i === 0 || asc[i - 1] <= v)) fail('sort', 'second click did not reverse the order');
  else ok('sort', 'clicking again reverses it');

  // filters
  await page.goto(`${BASE}/#/season`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const allRows = await page.$eval('.panel-head h2 + .hint, .panel-head h2', (n) => n.textContent);
  await page.selectOption('.filters select', { label: 'Dead Ball' });
  await page.waitForTimeout(700);
  const years = await page.$$eval('table.stats tbody tr td:nth-child(3)',
    (n) => n.slice(0, 25).map((x) => Number(x.textContent)));
  const inRange = years.every((y) => y >= 1901 && y <= 1919);
  if (!inRange) fail('filter', `era filter leaked years outside 1901-1919: ${years.slice(0, 5)}`);
  else ok('filter', `era filter holds (${allRows.trim()} -> all rows 1901-1919)`);

  // pagination
  await page.goto(`${BASE}/#/career`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const before = await page.$$eval('table.stats tbody tr', (n) => n.length);
  const moreBtn = await page.$('.more .btn');
  if (!moreBtn) fail('paging', 'no "show more" button on a long board');
  else {
    await moreBtn.click();
    await page.waitForTimeout(600);
    const after = await page.$$eval('table.stats tbody tr', (n) => n.length);
    if (after <= before) fail('paging', `show more did not add rows (${before} -> ${after})`);
    else ok('paging', `show more works (${before} -> ${after} rows)`);
  }

  // compare add/remove
  await page.goto(`${BASE}/#/compare/bondsba01,ruthba01`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const cards = await page.$$eval('.cmp-card', (n) => n.length);
  if (cards !== 2) fail('compare', `expected 2 cards, saw ${cards}`);
  else ok('compare', '2 players compared');
  await page.click('.cmp-card .btn');
  await page.waitForTimeout(700);
  const afterRemove = await page.$$eval('.cmp-card', (n) => n.length);
  if (afterRemove !== 1) fail('compare', `remove left ${afterRemove} cards, expected 1`);
  else ok('compare', 'remove works');

  // year explorer
  await page.goto(`${BASE}/#/year/2019`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const yearRows = await page.$$eval('table.stats tbody tr td:nth-child(3)',
    (n) => n.slice(0, 10).map((x) => x.textContent.trim()));
  if (!yearRows.length || !yearRows.every((y) => y === '2019')) {
    fail('year', `year explorer showed non-2019 rows: ${yearRows.slice(0, 4)}`);
  } else ok('year', '2019 leaders all from 2019');

  // ------------------------------------------------------- live degradation
  console.log('\n— live data —');
  {
    // With no route mock this sandbox cannot reach statsapi.mlb.com, which is
    // precisely the failure a visitor on a restrictive network would hit.
    await page.goto(`${BASE}/#/player/ohtansh01`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(11000);
    const txt = await page.evaluate(() => document.querySelector('#app').innerText);
    if (!/career batting/i.test(txt)) fail('live', 'a failed live fetch broke the historical page');
    else if (!/live stats unavailable/i.test(txt)) fail('live', 'no explanation shown when live data fails');
    else ok('live', 'failed fetch degrades cleanly and says so');
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
    const lp = await ctx.newPage();
    const jsErrors = [];
    lp.on('pageerror', (e) => jsErrors.push(e.message));
    await lp.route('**/statsapi.mlb.com/**', (route) => {
      const hitting = route.request().url().includes('group=hitting');
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        stats: [{ splits: hitting ? [{
          player: { id: 1, fullName: 'Shohei Ohtani' }, team: { abbreviation: 'LAD' },
          stat: { gamesPlayed: 110, plateAppearances: 480, runs: 90, hits: 130, doubles: 25,
                  triples: 3, homeRuns: 40, rbi: 95, stolenBases: 15, baseOnBalls: 60,
                  intentionalWalks: 12, hitByPitch: 4 } }] : [{
          player: { id: 1, fullName: 'Shohei Ohtani' }, team: { abbreviation: 'LAD' },
          stat: { gamesPlayed: 14, gamesStarted: 14, wins: 7, losses: 2, completeGames: 0,
                  shutouts: 0, saves: 0, holds: 3, blownSaves: 1, earnedRuns: 22,
                  strikeOuts: 92, inningsPitched: '74.1', era: '2.66' } }] }] }) });
    });
    await lp.goto(`${BASE}/#/live`, { waitUntil: 'networkidle' });
    await lp.waitForTimeout(2000);
    const pts = await lp.$eval('table.stats tbody tr td:last-child', (n) => Number(n.textContent.replace(/,/g, '')));
    // R90 + 1B62 + 2B50 + 3B9 + HR120 + RBI95 + SB30 + BB60 + IBB12 + HBP4
    if (pts !== 532) fail('live', `live batting scored ${pts}, expected 532`);
    else ok('live', `live scoring matches the league weights (${pts} pts)`);
    await lp.goto(`${BASE}/#/player/ohtansh01`, { waitUntil: 'networkidle' });
    await lp.waitForTimeout(2000);
    const heads = await lp.$$eval('.panel-head h2', (n) => n.map((x) => x.textContent));
    if (!heads.some((h) => /season — live/.test(h))) fail('live', 'live block missing on an active player');
    else ok('live', 'live block attaches to an active player page');
    if (jsErrors.length) fail('live', `js errors: ${jsErrors.join('|')}`);
    await ctx.close();
  }

  await desktop.close();

  // -------------------------------------------------------------- layout
  console.log('\n— layout —');
  const ROUTES = ['#/player/bondsba01', '#/player/riverma01', '#/player/ohtansh01',
                  '#/career', '#/season', '#/year/1998', '#/live', '#/compare/bondsba01,ruthba01',
                  '#/scoring', '#/about', '#/contact', '#/privacy', '#/terms'];
  for (const [w, h, name, mobile] of [[390, 844, 'phone', true], [1400, 950, 'desktop', false]]) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h }, isMobile: mobile,
      deviceScaleFactor: mobile ? 2 : 1, hasTouch: mobile,
    });
    const p2 = await ctx.newPage();
    p2.on('pageerror', (e) => fail(`js/${name}`, e.message));
    let clean = 0;
    for (const route of ROUTES) {
      await p2.goto(`${BASE}/${route}`, { waitUntil: 'networkidle' });
      await p2.waitForTimeout(500);
      const issues = await layoutIssues(p2);
      if (issues.length) fail(`layout/${name}`, `${route} — ${issues.join('; ')}`);
      else clean++;
    }
    ok(`layout/${name}`, `${clean}/${ROUTES.length} routes clean at ${w}px`);
    await ctx.close();
  }

  // -------------------------------------------------------------- themes
  console.log('\n— themes —');
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const p3 = await ctx.newPage();
    await p3.addInitScript(`try{localStorage.setItem('fa-theme','${theme}')}catch(e){}`);
    await p3.goto(`${BASE}/#/player/riverma01`, { waitUntil: 'networkidle' });
    await p3.waitForTimeout(700);
    const r = await p3.evaluate(() => {
      const body = getComputedStyle(document.body).backgroundColor;
      const txt = getComputedStyle(document.querySelector('.ph-name')).color;
      const lum = (c) => {
        const [r, g, b] = c.match(/\d+/g).map(Number);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      return { body, txt, contrast: Math.abs(lum(body) - lum(txt)) };
    });
    if (r.contrast < 90) fail('theme', `${theme}: text/background too close (${Math.round(r.contrast)})`);
    else ok('theme', `${theme} contrast ${Math.round(r.contrast)} (bg ${r.body})`);
    await ctx.close();
  }

  await browser.close();

  console.log(`\n${'='.repeat(60)}`);
  if (problems.length) {
    console.log(`${problems.length} PROBLEM(S):`);
    problems.forEach((p) => console.log(`  ✗ ${p}`));
    process.exit(1);
  }
  console.log('All checks passed.');
})();
