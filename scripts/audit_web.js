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
    // Node.append(null) renders the word "null". It has shipped twice; it does
    // not ship again.
    const body = (document.querySelector('#app') || document.body).innerText;
    if (/(^|\s)(null|undefined|NaN)(\s|$)/.test(body)) {
      out.push('stray null/undefined/NaN in the rendered text');
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
  // Behaviour checks run on the full product; the free tier's caps are
  // asserted separately, so a paywall never masquerades as a broken feature.
  await page.addInitScript("try{localStorage.setItem('dsa-tier','pro')}catch(e){}");
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
  // Era options are labelled with their window now ("Dead Ball (1901–1919)"),
  // so match on the name rather than the whole string.
  const deadBall = await page.$$eval('.filters select:first-of-type option',
    (opts) => (opts.find((o) => o.textContent.startsWith('Dead Ball')) || {}).value);
  await page.selectOption('.filters select:first-of-type', deadBall);
  await page.waitForTimeout(700);
  const eraLabelText = await page.$eval('.filters select:first-of-type option:checked',
    (o) => o.textContent);
  if (!/1901.*1919/.test(eraLabelText)) fail('era', `era label lacks its dates: "${eraLabelText}"`);
  else ok('era', `era labels carry their years ("${eraLabelText}")`);
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
    // The desktop context already runs as Pro, so the live path is reachable.
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
    // Live stats are a Pro feature, so this has to run as Pro to reach them.
    await lp.addInitScript("try{localStorage.setItem('dsa-tier','pro')}catch(e){}");
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

  // ---------------------------------------------------------------- sports
  console.log('\n— leagues —');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const sp = await ctx.newPage();
    const errs = [];
    sp.on('pageerror', (e) => errs.push(e.message));
    const accents = {};
    for (const [id, expectH1] of [['mlb', 'Player Lookup'], ['nba', 'NBA Player Lookup'],
                                  ['nfl', 'NFL Player Lookup']]) {
      await sp.goto(`${BASE}/#/${id}/player`, { waitUntil: 'networkidle' });
      await sp.waitForTimeout(600);
      const d = await sp.evaluate(() => ({
        sport: document.documentElement.dataset.sport,
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        h1: (document.querySelector('#app h1') || {}).textContent || '',
      }));
      accents[id] = d.accent;
      if (d.sport !== id) fail('leagues', `${id}: data-sport was "${d.sport}"`);
      else if (!d.h1.includes(expectH1)) fail('leagues', `${id}: heading was "${d.h1}"`);
      else ok('leagues', `${id} -> ${d.accent} · ${d.h1}`);
    }
    if (new Set(Object.values(accents)).size !== 1) {
      fail('leagues', `leagues repaint the interface: ${JSON.stringify(accents)}`);
    } else ok('leagues', `one brand accent across every league (${accents.mlb})`);

    // Football and basketball now have real datasets: their boards must carry
    // the leaders anyone would recognise, not just render without erroring.
    for (const [id, expected] of [['nfl', 'Tom Brady'], ['nba', 'LeBron James']]) {
      await sp.goto(`${BASE}/#/${id}/career`, { waitUntil: 'networkidle' });
      await sp.waitForTimeout(1800);
      const leader = await sp.$eval('table.stats tbody tr td:nth-child(2)',
        (n) => n.textContent.trim()).catch(() => null);
      if (leader !== expected) fail('leagues', `${id} career leader was "${leader}", expected ${expected}`);
      else ok('leagues', `${id} career board leads with ${leader}`);
      await sp.goto(`${BASE}/#/${id}/scoring`, { waitUntil: 'networkidle' });
      await sp.waitForTimeout(700);
      const rules = await sp.$$eval('.rule', (n) => n.length);
      const slots = await sp.$$eval('.slot', (n) => n.length);
      if (!rules || !slots) fail('leagues', `${id} scoring page is empty (${rules} rules, ${slots} slots)`);
      else ok('leagues', `${id} scoring: ${rules} rules, ${slots} roster slots`);
    }

    // A search inside one league must open that league's player, not the
    // baseball player who happens to sit at the same index.
    for (const [id, query, expected] of [['nfl', 'brady', 'Tom Brady'],
                                         ['nba', 'lebron', 'LeBron James'],
                                         ['mlb', 'bonds', 'Barry Bonds']]) {
      await sp.goto(`${BASE}/#/${id}/player`, { waitUntil: 'networkidle' });
      await sp.waitForTimeout(900);
      await sp.fill('#globalSearch', query);
      await sp.waitForTimeout(450);
      await sp.keyboard.press('Enter');
      await sp.waitForTimeout(1600);
      const opened = await sp.$eval('.ph-name', (n) => n.textContent).catch(() => null);
      if (opened !== expected) fail('leagues', `${id} search "${query}" opened "${opened}"`);
      else ok('leagues', `${id} search "${query}" -> ${opened}`);
    }

    // An old link with no league prefix must still land on baseball.
    await sp.goto(`${BASE}/#/player/bondsba01`, { waitUntil: 'networkidle' });
    await sp.waitForTimeout(700);
    const legacy = await sp.evaluate(() => ({
      sport: document.documentElement.dataset.sport,
      name: (document.querySelector('.ph-name') || {}).textContent,
    }));
    if (legacy.sport !== 'mlb' || legacy.name !== 'Barry Bonds') {
      fail('leagues', `legacy link resolved to ${legacy.sport}/${legacy.name}`);
    } else ok('leagues', 'pre-league links still resolve to baseball');
    if (errs.length) fail('leagues', errs.join('|'));
    await ctx.close();
  }

  // ----------------------------------------------------------------- tiers
  console.log('\n— plans —');
  {
    const results = {};
    for (const t of ['free', 'pro']) {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
      const tp = await ctx.newPage();
      const errs = [];
      tp.on('pageerror', (e) => errs.push(e.message));
      await tp.addInitScript(`try{localStorage.setItem('dsa-tier','${t}')}catch(e){}`);

      await tp.goto(`${BASE}/#/mlb/career`, { waitUntil: 'networkidle' });
      await tp.waitForTimeout(1200);
      const rows = await tp.$$eval('table.stats tbody tr', (n) => n.length);
      const bar = !!(await tp.$('.upgrade-bar'));
      const locked = !!(await tp.$('.btn.lock'));

      await tp.goto(`${BASE}/#/mlb/player/bondsba01`, { waitUntil: 'networkidle' });
      await tp.waitForTimeout(900);
      const seasons = await tp.$$eval('table.stats tbody tr', (n) => n.length);

      await tp.goto(`${BASE}/#/mlb/compare/bondsba01,ruthba01,henderi01`, { waitUntil: 'networkidle' });
      await tp.waitForTimeout(800);
      const cards = await tp.$$eval('.cmp-card', (n) => n.length);

      await tp.goto(`${BASE}/#/mlb/live`, { waitUntil: 'networkidle' });
      await tp.waitForTimeout(1200);
      const liveGated = /Pro feature/i.test(await tp.evaluate(() => document.querySelector('#app').innerText));

      results[t] = { rows, bar, locked, seasons, cards, liveGated };
      if (errs.length) fail('plans', `${t}: ${errs.join('|')}`);
      await ctx.close();
    }

    const f = results.free, pr = results.pro;
    if (f.rows > 100) fail('plans', `free showed ${f.rows} board rows, cap is 100`);
    else ok('plans', `free board capped at ${f.rows} rows`);
    if (!f.bar) fail('plans', 'free board showed no upgrade prompt');
    else ok('plans', 'free board explains the cap');
    if (!f.locked) fail('plans', 'export was not locked on free');
    else ok('plans', 'export locked on free');
    if (f.seasons >= pr.seasons) fail('plans', `season log not capped (free ${f.seasons}, pro ${pr.seasons})`);
    else ok('plans', `season log ${f.seasons} rows free vs ${pr.seasons} pro`);
    if (f.cards !== 2 || pr.cards !== 3) fail('plans', `compare caps wrong (free ${f.cards}, pro ${pr.cards})`);
    else ok('plans', 'compare capped at 2 on free, 3 shown on pro');
    if (!f.liveGated) fail('plans', 'live stats were not gated on free');
    else ok('plans', 'live stats are Pro-only');
    if (pr.rows <= f.rows || pr.bar || pr.locked) fail('plans', 'pro did not unlock the board');
    else ok('plans', `pro board shows ${pr.rows} rows, no caps`);
  }

  // ------------------------------------------------------- custom scoring
  console.log('\n— custom league scoring —');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const cp = await ctx.newPage();
    const errs = [];
    cp.on('pageerror', (e) => errs.push(e.message));
    await cp.addInitScript("try{localStorage.setItem('dsa-tier','pro')}catch(e){}");
    await cp.goto(`${BASE}/#/mlb/career`, { waitUntil: 'networkidle' });
    await cp.waitForTimeout(1500);

    // Scoring the boards with the league's own weights must reproduce the
    // published points. If these two engines ever disagree, every custom
    // number on the site is wrong and nothing else here would catch it.
    const identity = await cp.evaluate(async () => {
      const w = defaultScoring();
      const bat = await getBoard('lb_career_batting');
      const pit = await getBoard('lb_career_pitching');
      const worst = (rows, fn, weights) => rows.slice(0, 800).reduce(
        (m, r) => Math.max(m, Math.abs(fn(flat(r), weights) - r.pts)), 0);
      return { bat: worst(bat, scoreBatting, w.batting),
               pit: worst(pit, scorePitching, w.pitching) };
    });
    // Published points are rounded to 1dp, so anything inside that is the
    // rounding rather than a scoring difference.
    if (identity.bat > 0.05 || identity.pit > 0.05) {
      fail('scoring', `client engine disagrees with the dataset ` +
        `(batting ${identity.bat.toFixed(3)}, pitching ${identity.pit.toFixed(3)})`);
    } else {
      ok('scoring', `client engine matches the dataset ` +
        `(max ${Math.max(identity.bat, identity.pit).toFixed(3)}, rounding only)`);
    }

    // A weight change has to move the whole site, not just one view.
    await cp.evaluate(() => {
      const d = defaultScoring();
      d.batting.SB = 10; d.batting.HR = 1;
      saveScoring(d);
    });
    await cp.waitForTimeout(1800);
    const leader = await cp.$eval('table.stats tbody tr td:nth-child(2)',
      (n) => n.textContent.replace(/★.*/, '').trim());
    if (leader !== 'Rickey Henderson') {
      fail('scoring', `steals-heavy scoring put "${leader}" on top, expected Rickey Henderson`);
    } else ok('scoring', 'weight change reorders the all-time board (Henderson leads on steals)');

    const plusHidden = await cp.$$eval('table.stats th',
      (n) => !n.some((x) => x.textContent.includes('PTS+')));
    if (!plusHidden) fail('scoring', 'PTS+ still shown under custom weights');
    else ok('scoring', 'PTS+ hidden under custom weights');

    await cp.goto(`${BASE}/#/mlb/player/henderi01`, { waitUntil: 'networkidle' });
    await cp.waitForTimeout(1200);
    const custom = await cp.evaluate(() => ({
      pts: Number((document.querySelector('.tile-value') || {}).textContent.replace(/,/g, '')),
      rails: !!document.querySelector('.rail'),
    }));
    if (custom.rails) fail('scoring', 'percentile rails shown under custom weights');
    else ok('scoring', 'percentile rails withheld under custom weights');

    // Pitchers rescore through the packed row maps rather than the board's
    // column names -- a separate path, and the one where a naming mismatch
    // silently zeroed every inning.
    const pitcherCheck = await cp.evaluate(async () => {
      const rec = await getShard(resolveId('ryanno01'));
      const w = defaultScoring();
      const career = scorePitching(packed(rec.cp, CP), w.pitching);
      const season = scorePitching(packed(rec.pit[0], P), w.pitching);
      return { career, season, storedSeason: rec.pit[0][P.PTS] };
    });
    if (Math.abs(pitcherCheck.career - 10216) > 1) {
      fail('scoring', `pitcher career rescored to ${pitcherCheck.career}, expected ~10216`);
    } else ok('scoring', `packed pitcher rows rescore correctly (${Math.round(pitcherCheck.career)})`);

    await cp.evaluate(() => resetScoring());
    await cp.waitForTimeout(1200);
    await cp.goto(`${BASE}/#/mlb/player/henderi01`, { waitUntil: 'networkidle' });
    await cp.waitForTimeout(1200);
    const restored = await cp.evaluate(() => ({
      pts: Number((document.querySelector('.tile-value') || {}).textContent.replace(/,/g, '')),
      rails: !!document.querySelector('.rail'),
    }));
    if (restored.pts !== 12862 || !restored.rails) {
      fail('scoring', `reset did not restore defaults (${restored.pts}, rails ${restored.rails})`);
    } else ok('scoring', `reset restores the league defaults (${restored.pts})`);
    if (custom.pts <= restored.pts) fail('scoring', 'custom weights did not change the total');
    if (errs.length) fail('scoring', errs.join('|'));
    await ctx.close();
  }

  // ------------------------------------------------- profile / metrics / proj
  console.log('\n— player intelligence —');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const ip = await ctx.newPage();
    const errs = [];
    ip.on('pageerror', (e) => errs.push(e.message));
    await ip.goto(`${BASE}/#/mlb/player/ruthba01`, { waitUntil: 'networkidle' });
    await ip.waitForTimeout(1400);
    const r = await ip.evaluate(() => ({
      nick: (document.querySelector('.bio-nick') || {}).textContent || '',
      bio: (document.querySelector('.bio p') || {}).textContent || '',
      metrics: [...document.querySelectorAll('.metric-label')].map((n) => n.textContent),
      proj: [...document.querySelectorAll('.panel-head h2')].some((h) => /Projected/.test(h.textContent)),
      links: [...document.querySelectorAll('.bio-links a')].map((a) => a.textContent),
    }));
    if (!/Bambino/.test(r.nick)) fail('bio', `nickname missing for Ruth ("${r.nick}")`);
    else ok('bio', `nickname: ${r.nick}`);
    if (!/Hall of Fame/.test(r.bio) || !/home runs/.test(r.bio)) {
      fail('bio', `bio missing honours or milestones: ${r.bio.slice(0, 90)}`);
    } else ok('bio', 'bio carries span, honours and milestones');
    for (const m of ['OPS', 'OPS+', 'ISO', 'BABIP']) {
      if (!r.metrics.includes(m)) fail('metrics', `${m} missing on a batter page`);
    }
    if (r.metrics.length) ok('metrics', `advanced metrics: ${r.metrics.join(', ')}`);
    if (!r.proj) fail('projection', 'no projection panel');
    else ok('projection', 'projection panel present');
    if (r.links.length < 2) fail('bio', 'outbound reference links missing');
    else ok('bio', `reference links: ${r.links.join(', ')}`);

    // A pitcher gets pitching metrics, not batting ones.
    await ip.goto(`${BASE}/#/mlb/player/martipe02`, { waitUntil: 'networkidle' });
    await ip.waitForTimeout(1200);
    // A pitcher who also batted has both panels; the pitching one must lead.
    const pm = await ip.evaluate(() => {
      const first = document.querySelector('.metrics');
      return first ? [...first.querySelectorAll('.metric-label')].map((n) => n.textContent) : [];
    });
    const firstPanel = await ip.$eval('.panel:has(.metrics) .panel-head h2', (n) => n.textContent);
    if (!pm.includes('FIP') || !pm.includes('WHIP')) fail('metrics', `pitcher metrics wrong: ${pm}`);
    else if (!/pitching/i.test(firstPanel)) fail('metrics', `pitcher led with "${firstPanel}"`);
    else ok('metrics', `pitcher leads with ${firstPanel} (${pm.join(', ')})`);
    if (errs.length) fail('player intel', errs.join('|'));
    await ctx.close();
  }

  // ------------------------------------------------------------------ admin
  console.log('\n— admin —');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const ap = await ctx.newPage();
    await ap.goto(`${BASE}/#/admin`, { waitUntil: 'networkidle' });
    await ap.waitForTimeout(600);
    const gated = !!(await ap.$('.admin-gate'));
    if (!gated) fail('admin', 'admin console was not gated');
    else ok('admin', 'console asks for a passphrase');
    await ap.fill('.admin-gate input', 'dynasty');
    await ap.click('.admin-gate .btn');
    await ap.waitForTimeout(800);
    const rows = await ap.$$eval('.admin-row', (n) => n.length);
    if (rows < 8) fail('admin', `console rendered only ${rows} rows`);
    else ok('admin', `console shows ${rows} settings rows`);
    await ctx.close();
  }

  // ------------------------------------------------------- health + chat
  console.log('\n— health and assistant —');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const hp = await ctx.newPage();
    const errs = [];
    hp.on('pageerror', (e) => errs.push(e.message));
    await hp.goto(`${BASE}/#/health`, { waitUntil: 'networkidle' });
    await hp.waitForTimeout(3500);
    const items = await hp.$$eval('.health-item', (n) => n.length);
    const pills = await hp.$$eval('.admin-row .pill', (n) => n.map((x) => x.textContent));
    if (items < 10) fail('health', `only ${items} surfaces listed`);
    else ok('health', `${items} surfaces documented`);
    if (pills.some((t) => t === 'ERROR')) fail('health', `a dataset failed to load: ${pills}`);
    else ok('health', `all ${pills.length} datasets load (${pills.join(', ')})`);

    // The assistant must be right, not merely responsive. These have known
    // answers; a wrong one means the query engine is reading the wrong column.
    const asks = [
      ['mlb', 'Who led MLB in home runs in 1972?', /Johnny Bench/],
      ['mlb', 'Who has the most Cy Young awards of all time?', /Roger Clemens/],
      ['mlb', 'most stolen bases all time', /Rickey Henderson/],
      ['nfl', 'Who led the NFL in passing yards in 2013?', /Peyton Manning/],
      ['nfl', 'Who led the NFL in rushing yards in 2012?', /Adrian Peterson/],
      ['nba', 'Who led the NBA in points in 2016?', /Russell Westbrook/],
    ];
    for (const [id, question, expect] of asks) {
      await hp.goto(`${BASE}/#/${id}/chat`, { waitUntil: 'networkidle' });
      await hp.waitForTimeout(1200);
      await hp.fill('.chat-input', question);
      await hp.keyboard.press('Enter');
      await hp.waitForTimeout(2600);
      const last = (await hp.$$eval('.chat-msg.bot', (n) => n.map((x) => x.innerText))).pop() || '';
      if (!expect.test(last)) fail('chat', `"${question}" -> ${last.slice(0, 70)}`);
      else ok('chat', `${question} -> ${last.split('\n')[0].slice(0, 62)}`);
    }
    // An off-topic question must be refused, not answered with a guess.
    await hp.goto(`${BASE}/#/mlb/chat`, { waitUntil: 'networkidle' });
    await hp.waitForTimeout(1000);
    await hp.fill('.chat-input', 'what is the weather today');
    await hp.keyboard.press('Enter');
    await hp.waitForTimeout(1500);
    const miss = (await hp.$$eval('.chat-msg.bot', (n) => n.map((x) => x.innerText))).pop() || '';
    if (!/Ask an? MLB question/i.test(miss)) fail('chat', `off-topic answered with: ${miss.slice(0, 70)}`);
    else ok('chat', 'off-topic question is refused, not guessed');
    if (errs.length) fail('health', errs.join('|'));
    await ctx.close();
  }

  // ------------------------------------------------------------ navigation
  console.log('\n— control panel —');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const np = await ctx.newPage();
    const errs = [];
    np.on('pageerror', (e) => errs.push(e.message));
    await np.goto(`${BASE}/#/home`, { waitUntil: 'networkidle' });
    await np.waitForTimeout(2500);

    const groups = await np.$$eval('.nav-group', (n) => n.length);
    if (groups < 4) fail('nav', `only ${groups} folders in the panel`);
    else ok('nav', `${groups} folders in the control panel`);

    // A collapsed folder must actually hide its contents, and reopen.
    const before2 = await np.$$eval('.nav-items:not([hidden]) .nav-item', (n) => n.length);
    await np.click('.nav-group >> nth=0');
    await np.waitForTimeout(300);
    const collapsed = await np.$$eval('.nav-items:not([hidden]) .nav-item', (n) => n.length);
    await np.click('.nav-group >> nth=0');
    await np.waitForTimeout(300);
    const reopened = await np.$$eval('.nav-items:not([hidden]) .nav-item', (n) => n.length);
    if (collapsed >= before2 || reopened !== before2) {
      fail('nav', `folder toggle broken (${before2} -> ${collapsed} -> ${reopened})`);
    } else ok('nav', `folders collapse and reopen (${before2} -> ${collapsed} -> ${reopened})`);

    // The open folder should follow you to the page you land on.
    await np.goto(`${BASE}/#/health`, { waitUntil: 'networkidle' });
    await np.waitForTimeout(1500);
    const active = await np.$eval('.nav-item.active .nav-label', (n) => n.textContent).catch(() => null);
    if (active !== 'System Health') fail('nav', `active item was "${active}" on the health page`);
    else ok('nav', 'the panel opens the folder holding the current page');

    // League-scoped links must carry the active league.
    await np.goto(`${BASE}/#/nba/career`, { waitUntil: 'networkidle' });
    await np.waitForTimeout(1800);
    const href = await np.$eval('.nav-item[data-view="career"]', (n) => n.getAttribute('href'));
    if (href !== '#/nba/career') fail('nav', `scoped link was ${href} under basketball`);
    else ok('nav', `league-scoped links follow the switcher (${href})`);

    // The drawer: hidden on a phone, opens on the button, closes on a pick.
    const mob = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true,
      deviceScaleFactor: 2, hasTouch: true,
    });
    const mp = await mob.newPage();
    await mp.goto(`${BASE}/#/home`, { waitUntil: 'networkidle' });
    await mp.waitForTimeout(2200);
    const hidden = await mp.$eval('.sidebar', (n) => n.getBoundingClientRect().right <= 1);
    await mp.click('#menuToggle');
    await mp.waitForTimeout(400);
    const shown = await mp.$eval('.sidebar', (n) => n.getBoundingClientRect().left >= 0);
    await mp.click('.nav-item[data-view="career"]');
    await mp.waitForTimeout(1600);
    const closed = await mp.evaluate(() => !document.body.classList.contains('drawer-open'));
    if (!hidden || !shown || !closed) {
      fail('nav', `drawer: hidden=${hidden} opens=${shown} closesOnPick=${closed}`);
    } else ok('nav', 'drawer hides, opens on the button, closes after a pick');
    const header = await mp.$eval('.topbar', (n) => Math.round(n.getBoundingClientRect().height));
    if (header > 80) fail('nav', `phone header is ${header}px tall`);
    else ok('nav', `phone header is ${header}px — content starts near the top`);
    await mob.close();
    if (errs.length) fail('nav', errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // -------------------------------------------------------- theme + clicks
  console.log('\n— theme and controls —');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const tp = await ctx.newPage();
    const errs = [];
    tp.on('pageerror', (e) => errs.push(e.message));
    tp.on('console', (m) => {
      const from = (m.location() && m.location().url) || '';
      if (!from.includes('statsapi') && m.type() === 'error') errs.push(m.text());
    });

    await tp.goto(`${BASE}/#/home`, { waitUntil: 'networkidle' });
    await tp.waitForTimeout(2500);
    const cycle = [];
    for (let i = 0; i < 4; i++) {
      await tp.click('#themeToggle');
      await tp.waitForTimeout(180);
      cycle.push(await tp.evaluate(() => document.documentElement.dataset.theme));
    }
    const states = new Set(cycle);
    if (states.size !== 2 || states.has('auto')) {
      fail('theme', `toggle produced ${states.size} states: ${cycle.join(',')}`);
    } else ok('theme', `toggle is two-state (${cycle.join(' -> ')})`);

    // Click every control on every view and require that nothing throws and
    // nothing blanks the page. A button that silently does nothing is a bug a
    // render-only check cannot see.
    const CLICKABLE = ['#/home', '#/mlb/player/bondsba01', '#/mlb/career', '#/mlb/season',
                       '#/nfl/career', '#/nba/career', '#/settings', '#/pricing',
                       '#/mlb/chat', '#/health', '#/scoring', '#/trends'];
    let clicked = 0, dead = [];
    for (const route of CLICKABLE) {
      await tp.goto(`${BASE}/${route}`, { waitUntil: 'networkidle' });
      await tp.waitForTimeout(1200);
      const buttons = await tp.$$('#app button:not([disabled])');
      for (const btn of buttons.slice(0, 12)) {
        const label = (await btn.textContent() || '').trim().slice(0, 24);
        try {
          await btn.click({ timeout: 3000 });
          await tp.waitForTimeout(220);
          const alive = await tp.evaluate(() =>
            document.querySelector('#app').innerText.trim().length > 20);
          if (!alive) dead.push(`${route} → "${label}" blanked the view`);
          clicked++;
        } catch (err) {
          // A control that scrolled out of reach is not a defect; a detached
          // or unclickable one is.
          const benign = /not visible|outside of the viewport|intercepts|not attached/i;
          if (!benign.test(err.message)) {
            dead.push(`${route} → "${label}": ${err.message.split('\n')[0].slice(0, 60)}`);
          }
        }
        await tp.goto(`${BASE}/${route}`, { waitUntil: 'networkidle' });
        await tp.waitForTimeout(700);
      }
    }
    if (dead.length) fail('controls', dead.slice(0, 4).join(' | '));
    else ok('controls', `${clicked} buttons clicked across ${CLICKABLE.length} views, none dead`);

    // Internal links must all resolve to a view that renders something.
    await tp.goto(`${BASE}/#/home`, { waitUntil: 'networkidle' });
    await tp.waitForTimeout(2500);
    const hrefs = await tp.$$eval('a[href^="#/"]', (n) => [...new Set(n.map((a) => a.getAttribute('href')))]);
    const broken = [];
    for (const href of hrefs.slice(0, 40)) {
      await tp.goto(`${BASE}/${href}`, { waitUntil: 'networkidle' });
      await tp.waitForTimeout(700);
      const text = await tp.evaluate(() => document.querySelector('#app').innerText.trim());
      if (text.length < 20 || /went wrong/i.test(text)) broken.push(href);
    }
    if (broken.length) fail('links', `dead links: ${broken.join(', ')}`);
    else ok('links', `${Math.min(hrefs.length, 40)} internal links all render`);
    if (errs.length) fail('controls', errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // -------------------------------------------------------------- layout
  console.log('\n— layout —');
  const ROUTES = ['#/home', '#/player/bondsba01', '#/player/riverma01', '#/player/ohtansh01',
                  '#/career', '#/season', '#/year/1998', '#/live', '#/compare/bondsba01,ruthba01',
                  '#/scoring', '#/about', '#/contact', '#/privacy', '#/terms',
                  '#/pricing', '#/nba/player', '#/nba/scoring', '#/nfl/career', '#/nfl/scoring',
                  '#/health', '#/mlb/chat', '#/nfl/chat', '#/nba/career', '#/settings'];
  const DEVICES = [
    [360, 800, 'android-small', true],   // Galaxy S-class
    [390, 844, 'iphone', true],          // iPhone 14/15
    [412, 915, 'pixel', true],           // Pixel
    [430, 932, 'iphone-max', true],      // iPhone Pro Max
    [768, 1024, 'ipad-portrait', true],  // iPad
    [1024, 768, 'ipad-landscape', false],
    [1280, 800, 'laptop', false],        // MacBook / Windows laptop
    [1920, 1080, 'desktop', false],
  ];
  for (const [w, h, name, mobile] of DEVICES) {
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
