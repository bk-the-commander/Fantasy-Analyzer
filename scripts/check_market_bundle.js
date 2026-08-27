const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = process.argv[2];
  // Reproduce the artifact host's wrapper: it supplies the doctype, head and body.
  const inner = fs.readFileSync(src, 'utf8');
  const wrapped = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${inner}</body></html>`;
  const tmp = path.join(path.dirname(src), 'wrapped.html');
  fs.writeFileSync(tmp, wrapped);

  const bundled = ['/opt/pw-browsers/chromium/chrome-linux/chrome',
                   '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(fs.existsSync);
  const browser = await chromium.launch(bundled ? { executablePath: bundled } : {});
  const errors = [];
  const results = [];
  const check = (ok, msg) => { if (!ok) errors.push(msg); results.push(`${ok ? '  ok  ' : ' FAIL '} ${msg}`); };

  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, colorScheme: scheme });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console(${scheme}): ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror(${scheme}): ${e.message}`));

    await page.goto('file://' + tmp, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 20000 });
    await page.waitForTimeout(700);

    check(await page.locator('.stat').count() >= 5, `${scheme}: overview stat tiles render from embedded data`);
    check(await page.locator('.heat-tile').count() > 20, `${scheme}: heatmap tiles render`);
    check(await page.locator('.news-item').count() > 0, `${scheme}: headlines render`);

    // body must paint its own ground, or it borrows the host's theme
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent', `${scheme}: body paints an explicit background (${bg})`);

    // navigate to a ticker: exercises the fetch shim on a per-symbol file
    const sym = await page.evaluate(async () => (await (await fetch('data/screener.json')).json())[0].symbol);
    await page.goto('file://' + tmp + `#/t/${sym}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.chart-shell canvas', { timeout: 20000 });
    await page.waitForTimeout(600);
    const painted = await page.evaluate(() => {
      const c = document.querySelector('.chart-shell canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lit = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) lit++;
      return lit;
    });
    check(painted > 4000, `${scheme}: ticker chart paints (${painted} px, ${sym})`);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(overflow <= 1, `${scheme}: no horizontal page overflow (${overflow}px)`);

    await page.screenshot({ path: path.join(path.dirname(src), `bundle-${scheme}.png`) });
    await page.close();
  }

  await browser.close();
  console.log(results.join('\n'));
  console.log(errors.length ? `\n${errors.length} PROBLEM(S):\n` + errors.slice(0, 10).join('\n') : '\nbundle is clean');
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
