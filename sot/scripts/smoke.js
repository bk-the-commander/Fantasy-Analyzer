/* Drives the built bundle and fails on any console error, empty screen, or
 * broken drill-through. The drill-through checks matter most: the product's
 * whole claim is that you can follow a thread from any record to any related
 * record, so the test walks one.
 *
 *     node sot/scripts/smoke.js [--shots]
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BUNDLE = path.join(__dirname, '..', 'dist', 'sot.html');
const SHOTS = path.join(__dirname, '..', 'dist', 'shots');
const wantShots = process.argv.includes('--shots');

const problems = [];
let n = 0;
function check(label, ok, detail) {
  n++;
  if (!ok) problems.push(label + (detail ? ' — ' + detail : ''));
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (detail && !ok ? '  — ' + detail : ''));
}
const shot = (page, name) => (wantShots ? page.screenshot({ path: path.join(SHOTS, name + '.png') }) : Promise.resolve());

(async () => {
  if (wantShots) fs.mkdirSync(SHOTS, { recursive: true });
  const pinned = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome']
    .find((p) => fs.existsSync(p));
  const browser = await chromium.launch(pinned ? { executablePath: pinned } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  const hash = (h) => page.evaluate((x) => { location.hash = x; }, h).then(() => page.waitForTimeout(260));
  const h1 = () => page.locator('.content h1').first().innerText();

  await page.goto('file://' + BUNDLE);
  await page.waitForSelector('.login', { timeout: 8000 });
  check('login offers every industry', (await page.locator('.login .chip').count()) === 6);
  check('login offers roles and the operator console',
    (await page.locator('.pick-card').count()) === 6 &&
    (await page.locator('[data-act="signin-owner"]').count()) === 1);
  await shot(page, 'login');

  // Sign in as the executive: whole-organisation scope.
  await page.locator('.pick-card', { hasText: 'Operations executive' }).click();
  await page.waitForSelector('.shell');
  check('signs in to the dashboard', (await h1()).includes('St. Aldwyn'));
  await shot(page, 'dashboard');

  for (const [h, expect, sel] of [
    ['#/t/staff', 'Staff', 'tbody tr'],
    ['#/t/patient', 'Patients', 'tbody tr'],
    ['#/t/unit', 'Units', 'tbody tr'],
    ['#/t/encounter', 'Visits', 'tbody tr'],
    ['#/integrity', 'Data integrity', 'tbody tr'],
    ['#/identity', 'Identity resolution', '.card'],
    ['#/systems', 'Connected systems', '.card'],
    ['#/tasks', 'Remediation', 'tbody tr'],
    ['#/admin', 'Administration', 'tbody tr'],
  ]) {
    await hash(h);
    check('renders ' + h, (await h1()).includes(expect) && (await page.locator('.content ' + sel).count()) > 0);
    if (wantShots && ['#/integrity', '#/identity', '#/systems', '#/t/staff'].includes(h)) await shot(page, h.replace(/[#/]/g, '') || 'x');
  }

  /* ---------------------------------------------------------- drill-through
   * Clinician → their ward → the ward's former roster → a previous member.
   */
  const clinicianId = await page.evaluate(() => {
    const v = window.SOT.app.store.view;
    const best = Object.values(v.profiles)
      .filter((p) => p.type === 'staff')
      .map((p) => ({ id: p.entity.id, n: v.graph.neighbours(p.entity.id, 'care_team', { dir: 'in' }).length }))
      .sort((a, b) => b.n - a.n)[0];
    return best.id;
  });
  await hash('#/e/' + clinicianId);
  check('clinician record opens', (await h1()).length > 2);
  check('statistics render on the record', (await page.locator('.content .stat').count()) > 3);
  check('deep links to every source system', (await page.locator('.content a.btn[target="_blank"]').count()) > 0);
  await shot(page, 'entity-staff');

  await page.locator('.tabs button', { hasText: 'Connections' }).click();
  await page.waitForTimeout(250);
  check('connections group by relationship', (await page.locator('.content .card-h h3').count()) > 1);
  await shot(page, 'entity-connections');

  // Follow the ward link out of the connections tab.
  const wardRow = page.locator('.content .card', { hasText: 'Unit assignment' }).locator('tbody tr').first();
  await wardRow.click();
  await page.waitForTimeout(300);
  check('drilled into the ward', (await page.locator('.content .tag').first().innerText()).toLowerCase().includes('unit'));
  check('trail records the path', (await page.locator('.trail a, .trail .cur').count()) >= 2);

  await page.locator('.tabs button', { hasText: 'Connections' }).click();
  await page.waitForTimeout(250);
  const rosterCard = page.locator('.content .card', { hasText: 'Staff roster' });
  check('ward shows a staff roster', (await rosterCard.count()) > 0);
  const previously = await page.locator('.content td', { hasText: 'Previously' }).count();
  check('roster separates current from previous', previously > 0);
  await shot(page, 'entity-unit');

  /* Patient → visit → care team → a different clinician. */
  await hash('#/t/patient');
  await page.locator('.content tbody tr').first().click();
  await page.waitForTimeout(300);
  check('patient record opens', (await page.locator('.content .tag').first().innerText()).toLowerCase().includes('patient'));
  await page.locator('.tabs button', { hasText: 'Timeline' }).click();
  await page.waitForTimeout(250);
  check('patient visit history renders', (await page.locator('.content .tev').count()) > 0);
  await shot(page, 'entity-patient');
  // A patient's timeline mixes visits with relationship changes; follow a visit.
  await page.locator('.content .tev[data-go^="#/e/ENC"]').first().click();
  await page.waitForTimeout(300);
  check('drilled into a visit', (await page.locator('.content .tag').first().innerText()).toLowerCase().includes('visit'));
  await page.locator('.tabs button', { hasText: 'Connections' }).click();
  await page.waitForTimeout(250);
  const team = page.locator('.content .card', { hasText: 'Care team' });
  check('visit lists the care team', (await team.count()) > 0);
  await team.locator('tbody tr').first().click();
  await page.waitForTimeout(300);
  check('drilled from the visit to a clinician', (await page.locator('.content .stat').count()) > 2);
  check('trail is now several records deep', (await page.locator('.trail a, .trail .cur').count()) >= 4);
  await shot(page, 'trail');

  /* --------------------------------------------------------- provenance --- */
  await page.locator('.tabs button', { hasText: 'Integrity' }).click();
  await page.waitForTimeout(250);
  check('provenance rows render', (await page.locator('.content .phead').count()) > 4);
  await page.locator('.content .phead').first().click();
  await page.waitForTimeout(200);
  check('a field expands to show every system', (await page.locator('.content .pbody').count()) > 0);
  await shot(page, 'entity-integrity');

  /* ------------------------------------------------------------- search --- */
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.pal');
  await page.locator('#pal-in').fill('4 West');
  await page.waitForTimeout(250);
  check('search finds records across types', (await page.locator('.pal .r').count()) > 0);
  await shot(page, 'search');
  await page.keyboard.press('Escape');

  /* --------------------------------------------------------- the drawer --- */
  await hash('#/integrity');
  await page.locator('.content tbody tr').first().click();
  await page.waitForSelector('.drawer');
  const dtext = await page.locator('.drawer').innerText();
  check('finding drawer explains the classification', /Divergence|Gap|Lag/.test(dtext));
  check('drawer names the systems and values', dtext.length > 200);
  await shot(page, 'drawer');
  await page.keyboard.press('Escape');

  /* --------------------------------------------------------- the policy --- */
  await hash('#/admin?tab=sor');
  await page.locator('tr[data-field="staff.homeUnit"]').click();
  await page.waitForTimeout(700);
  check('impact preview computes alternatives', (await page.locator('button[data-act="promote"]').count()) > 0);
  await page.locator('button[data-act="promote"]').first().click();
  await page.waitForTimeout(600);
  check('policy change is applied and reported', (await page.locator('.content .note').first().innerText()).includes('differ from the default'));
  await shot(page, 'admin');
  await page.locator('button[data-act="policy-reset"]').click();
  await page.waitForTimeout(400);

  /* ---------------------------------------------------- identity actions --- */
  await hash('#/identity');
  const qBefore = await page.locator('button[data-act="dismiss"]').count();
  check('identity queue has items', qBefore > 0);
  await page.locator('button[data-act="dismiss"]').first().click();
  await page.waitForTimeout(400);
  check('setting a record aside shrinks the queue', (await page.locator('button[data-act="dismiss"]').count()) < qBefore);

  /* ------------------------------------------------------------- scoping --- */
  await page.selectOption('select[data-act="role"]', 'workforce');
  await page.waitForTimeout(400);
  await hash('#/t/patient');
  check('workforce role is refused patients outright', (await page.locator('.content .note.critical').count()) > 0);
  await shot(page, 'scoped');

  await page.selectOption('select[data-act="role"]', 'nurse_manager');
  await page.waitForTimeout(400);
  await hash('#/t/staff');
  const scoped = await page.locator('.content tbody tr').count();
  check('nurse manager sees only their ward', scoped > 0 && scoped < 60, scoped + ' staff');

  await page.selectOption('select[data-act="role"]', 'exec');
  await page.waitForTimeout(400);
  await hash('#/t/patient');
  await page.locator('.content tbody tr').first().click();
  await page.waitForTimeout(300);
  check('executive sees the patient but not the clinical detail',
    (await page.locator('.content').innerText()).includes('restricted'));

  /* ------------------------------------------------- every industry ------
   * The same walk in each vertical: it must load, browse each of its own
   * entity types, open a record, render statistics and show findings — with
   * no engine change between them.
   */
  const packIds = await page.evaluate(() => window.SOT.app.store.packs.map((p) => p.id));
  check('six industries are registered', packIds.length === 6, packIds.join(','));

  for (const pid of packIds) {
    await page.evaluate((id) => { window.SOT.app.store.setPack(id); window.SOT.app.render(); }, pid);
    await page.waitForTimeout(500);
    await hash('#/dashboard');
    const tenant = await h1();
    check(pid + ': dashboard loads', tenant.length > 3, tenant);

    const types = await page.evaluate(() => window.SOT.app.store.view.pack.entityTypes.map((t) => t.id));
    let opened = 0;
    for (const ty of types) {
      await hash('#/t/' + ty);
      const rows = await page.locator('.content tbody tr').count();
      check(pid + ': browse ' + ty, rows > 0, rows + ' rows');
      if (rows > 0 && opened < 2) {
        await page.locator('.content tbody tr').first().click();
        await page.waitForTimeout(280);
        const stats = await page.locator('.content .stat').count();
        const tabs = await page.locator('.tabs button').count();
        check(pid + ': ' + ty + ' record opens with statistics', stats > 0 && tabs >= 5, 'stats=' + stats + ' tabs=' + tabs);
        await page.locator('.tabs button', { hasText: 'Connections' }).click();
        await page.waitForTimeout(220);
        check(pid + ': ' + ty + ' has connections', (await page.locator('.content .card-h h3').count()) > 0);
        opened++;
      }
    }
    await hash('#/integrity');
    check(pid + ': findings render', (await page.locator('.content tbody tr').count()) > 0);
    await hash('#/identity');
    check(pid + ': identity queue renders', (await page.locator('.content .stat').count()) > 3);
    await hash('#/admin');
    check(pid + ': policy admin renders', (await page.locator('.content tbody tr').count()) > 0);
    if (wantShots && (pid === 'salon' || pid === 'freight')) {
      await hash('#/dashboard');
      await shot(page, 'tenant-' + pid);
    }
  }

  /* --------------------------------------------------- operator console --- */
  await page.evaluate(() => { window.SOT.app.store.setPack('health'); window.SOT.app.store.signInOwner(); location.hash = '#/owner/tenants'; window.SOT.app.render(); });
  await page.waitForTimeout(3500);
  check('operator console lists every tenant', (await page.locator('.content tbody tr').count()) >= 6);
  check('operator console totals render', (await page.locator('.content .stat').count()) >= 5);
  await shot(page, 'owner-tenants');
  for (const [h, title] of [['#/owner/connectors', 'Connectors'], ['#/owner/model', 'Model'],
    ['#/owner/access', 'Access'], ['#/owner/audit', 'Activity'], ['#/owner/roadmap', 'Roadmap']]) {
    await hash(h);
    check('operator ' + h, (await h1()).includes(title) && (await page.locator('.content tbody tr').count()) > 0);
    if (wantShots) await shot(page, 'owner-' + title.toLowerCase());
  }
  await hash('#/owner/connectors');
  check('degraded connectors are surfaced', (await page.locator('.content .tag.critical').count()) > 0);
  await hash('#/owner/tenants');
  await page.locator('button[data-act="enter-tenant"]').first().click();
  await page.waitForTimeout(800);
  check('operator can drop into a tenant', (await page.locator('.rail .nav a').count()) > 6 &&
    (await page.locator('button[data-act="owner-console"]').count()) > 0);
  await page.evaluate(() => { window.SOT.app.store.setPack('health'); window.SOT.app.store.signIn('exec'); location.hash = '#/dashboard'; window.SOT.app.render(); });
  await page.waitForTimeout(600);

  /* ----------------------------------------------------- theme + layout --- */
  await page.emulateMedia({ colorScheme: 'dark' });
  await hash('#/dashboard');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('dark theme applies', bg !== 'rgb(246, 246, 247)' && bg !== 'rgba(0, 0, 0, 0)', bg);
  await shot(page, 'dark');
  await page.emulateMedia({ colorScheme: 'light' });

  await page.setViewportSize({ width: 430, height: 880 });
  await hash('#/integrity');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow on a phone', overflow <= 2, overflow + 'px');
  await shot(page, 'mobile');

  check('no console or page errors', errors.length === 0, errors.slice(0, 5).join(' | '));

  await browser.close();
  console.log('\n' + n + ' checks, ' + problems.length + ' failing');
  problems.forEach((p) => console.log('  ✗ ' + p));
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
