/* Drives the built bundle through every screen and fails on any console error,
 * page error, or screen that renders empty.
 *
 *     node source-of-truth/scripts/smoke.js [--shots]
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BUNDLE = path.join(__dirname, '..', 'dist', 'source-of-truth.html');
const SHOTS = path.join(__dirname, '..', 'dist', 'shots');
const wantShots = process.argv.includes('--shots');

const problems = [];
let checks = 0;

function check(label, ok, detail) {
  checks++;
  if (!ok) problems.push(label + (detail ? ' — ' + detail : ''));
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (detail && !ok ? '  — ' + detail : ''));
}

(async () => {
  if (wantShots) fs.mkdirSync(SHOTS, { recursive: true });
  // The environment ships a pinned Chromium that may not match the version
  // this Playwright build expects; point at it explicitly rather than
  // downloading another copy.
  const pinned = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome']
    .find((p) => fs.existsSync(p));
  const browser = await chromium.launch(pinned ? { executablePath: pinned } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('file://' + BUNDLE);
  await page.waitForSelector('.login', { timeout: 8000 });
  check('login screen renders', await page.locator('.role-card').count() === 4);

  await page.locator('.role-card', { hasText: 'RevOps' }).click();
  await page.waitForSelector('.shell');
  check('signs in and lands on data integrity', (await page.locator('h1').first().innerText()).includes('Data integrity'));

  const pages = [
    ['#/dashboard', 'Cobalt Systems', '.stat'],
    ['#/org', 'Organization explorer', '.pcard'],
    ['#/integrity', 'Data integrity', 'table tbody tr'],
    ['#/identity', 'Identity resolution', '.stat'],
    ['#/metrics', 'Metric reconciliation', '.wf-row'],
    ['#/systems', 'Connected systems', '.card'],
    ['#/tasks', 'Remediation', 'table tbody tr'],
    ['#/admin', 'Administration', 'table tbody tr'],
  ];
  for (const [hash, title, sel] of pages) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForTimeout(220);
    const h1 = await page.locator('.content h1').first().innerText();
    const n = await page.locator('.content ' + sel).count();
    check('renders ' + hash, h1.includes(title) && n > 0, 'h1="' + h1 + '" ' + sel + '=' + n);
    if (wantShots) await page.screenshot({ path: path.join(SHOTS, hash.replace(/[#/]/g, '') + '.png'), fullPage: false });
  }

  /* --- drill into the explorer -------------------------------------------- */
  await page.evaluate(() => { location.hash = '#/org'; });
  await page.waitForTimeout(200);
  await page.locator('.pcard').first().click();
  await page.waitForTimeout(200);
  check('explorer drills down', (await page.locator('.crumbs button').count()) >= 1);

  /* --- a person with real conflicts ---------------------------------------- */
  await page.evaluate(() => { location.hash = '#/integrity'; });
  await page.waitForTimeout(220);
  await page.locator('table tbody tr').first().click();
  await page.waitForSelector('.drawer', { timeout: 4000 });
  check('conflict drawer opens', (await page.locator('.drawer .section-title').count()) >= 2);
  const drawerText = await page.locator('.drawer').innerText();
  check('drawer explains the classification', /Divergence|Gap|Lag/.test(drawerText));
  if (wantShots) await page.screenshot({ path: path.join(SHOTS, 'drawer.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  /* --- profile tabs -------------------------------------------------------- */
  // Pick someone who actually has findings, so the integrity tab has content.
  const pid = await page.evaluate(() => {
    const v = window.SOT.app.store.view;
    const worst = v.conflicts.find((c) => c.severity === 'critical') || v.conflicts[0];
    return worst.personId;
  });
  await page.evaluate((id) => { location.hash = '#/person/' + id; }, pid);
  await page.waitForTimeout(300);
  check('profile renders', (await page.locator('.content h1').first().innerText()).length > 2);
  check('profile shows deep links to source systems', (await page.locator('.content a.btn[target="_blank"]').count()) > 0);
  for (const tab of ['Organization', 'Go-to-market', 'Systems', 'Data integrity']) {
    await page.locator('.tabs button', { hasText: tab }).first().click();
    await page.waitForTimeout(200);
    check('profile tab: ' + tab, (await page.locator('.content .card, .content .prov').count()) > 0);
    if (wantShots && tab === 'Data integrity') await page.screenshot({ path: path.join(SHOTS, 'profile-integrity.png'), fullPage: false });
  }
  await page.locator('.prov-head').first().click();
  await page.waitForTimeout(150);
  check('provenance row expands', (await page.locator('.prov-body').count()) > 0);

  /* --- search palette ------------------------------------------------------ */
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.palette', { timeout: 3000 });
  await page.locator('#palette-input').fill('Enterprise');
  await page.waitForTimeout(220);
  check('search returns results', (await page.locator('.palette .res').count()) > 0);
  if (wantShots) await page.screenshot({ path: path.join(SHOTS, 'search.png') });
  await page.keyboard.press('Escape');

  /* --- the policy lever ---------------------------------------------------- */
  await page.evaluate(() => { location.hash = '#/admin?tab=sor'; });
  await page.waitForTimeout(220);
  await page.locator('tr[data-field="territory"]').click();
  await page.waitForTimeout(600);
  check('impact preview computes', (await page.locator('button[data-action="promote"]').count()) > 0);
  const before = await page.evaluate(() => document.body.innerText.match(/Territory Planning/) ? 1 : 0);
  await page.locator('button[data-action="promote"]').first().click();
  await page.waitForTimeout(500);
  check('policy change applies', (await page.locator('.banner').first().innerText()).includes('differ from the default'));
  if (wantShots) await page.screenshot({ path: path.join(SHOTS, 'admin.png') });
  await page.locator('button[data-action="policy-reset"]').click();
  await page.waitForTimeout(400);

  /* --- identity queue actions --------------------------------------------- */
  await page.evaluate(() => { location.hash = '#/identity'; });
  await page.waitForTimeout(250);
  const queueBefore = await page.locator('button[data-action="confirm-link"]').count();
  if (queueBefore > 0) {
    await page.locator('button[data-action="confirm-link"]').first().click();
    await page.waitForTimeout(400);
    const queueAfter = await page.locator('button[data-action="confirm-link"]').count();
    check('confirming an identity link shrinks the queue', queueAfter < queueBefore, queueBefore + ' → ' + queueAfter);
  }

  /* --- role scoping -------------------------------------------------------- */
  await page.selectOption('select[data-action="role"]', 'manager');
  await page.waitForTimeout(300);
  await page.evaluate(() => { location.hash = '#/dashboard'; });
  await page.waitForTimeout(300);
  const scopedText = await page.locator('.content').innerText();
  check('manager role is scoped', scopedText.includes('My organization'));
  const scopedPeople = await page.evaluate(() => {
    const m = document.body.innerText.match(/People\n(\d+)/);
    return m ? Number(m[1]) : -1;
  });
  check('manager sees fewer people than the whole company', scopedPeople > 0 && scopedPeople < 60, 'sees ' + scopedPeople);

  /* --- restricted fields are redacted -------------------------------------- */
  await page.evaluate(() => {
    const el = document.querySelector('[data-goto^="#/person/"]');
    if (el) location.hash = el.getAttribute('data-goto');
  });
  await page.waitForTimeout(250);
  await page.locator('.tabs button', { hasText: 'Go-to-market' }).first().click();
  await page.waitForTimeout(250);
  check('quota is redacted for the manager role', (await page.locator('.content').innerText()).includes('🔒'));

  /* --- dark mode ----------------------------------------------------------- */
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => { location.hash = '#/dashboard'; });
  await page.waitForTimeout(300);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('dark theme applies', bg !== 'rgb(246, 247, 249)' && bg !== 'rgba(0, 0, 0, 0)', bg);
  if (wantShots) await page.screenshot({ path: path.join(SHOTS, 'dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });

  /* --- narrow viewport ------------------------------------------------------ */
  await page.setViewportSize({ width: 430, height: 860 });
  await page.evaluate(() => { location.hash = '#/integrity'; });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow on mobile', overflow <= 2, overflow + 'px');
  if (wantShots) await page.screenshot({ path: path.join(SHOTS, 'mobile.png'), fullPage: false });

  check('no console or page errors', errors.length === 0, errors.slice(0, 6).join(' | '));

  await browser.close();
  console.log('\n' + checks + ' checks, ' + problems.length + ' failing');
  if (problems.length) { problems.forEach((p) => console.log('  ✗ ' + p)); process.exit(1); }
  console.log('smoke passed\n');
})().catch((e) => { console.error(e); process.exit(1); });
