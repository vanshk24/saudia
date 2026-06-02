/**
 * Selector inspector for the Saudia "Manage booking" form.
 *
 * Why this exists: page.pause() / the Playwright Inspector are NOT available
 * here — this project uses `playwright-core` (no bundled Inspector) and connects
 * to your own Chrome via CDP. This script is the reliable substitute: it attaches
 * to the same Chrome and dumps every visible input/button on each saudia.com tab
 * so we can read the exact Angular Material selectors.
 *
 * Usage (with Chrome already running on the debug port, Manage tab open):
 *     node debug/inspect-form.js          # uses port 9222
 *     node debug/inspect-form.js 9223     # custom port
 *
 * IMPORTANT: it never calls browser.close() — that would close your Chrome via
 * CDP. It just detaches and exits.
 */
const { chromium } = require('playwright-core');

(async () => {
  const port = process.argv[2] || '9222';
  console.log(`Connecting to Chrome on http://127.0.0.1:${port} …`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15000 });
  } catch (err) {
    console.error(`Could not connect: ${err.message}`);
    console.error(`Make sure Chrome is running with --remote-debugging-port=${port}`);
    process.exit(1);
  }

  const pages = browser.contexts().flatMap((c) => c.pages());
  const saudia = pages.filter((p) => (p.url() || '').toLowerCase().includes('saudia.com'));

  console.log(`Found ${pages.length} tab(s), ${saudia.length} on saudia.com\n`);

  for (const page of saudia) {
    console.log('============================================================');
    console.log('TAB:', page.url());
    console.log('============================================================');
    try {
      const controls = await page.evaluate(() => {
        const pick = (el) => {
          const r = el.getBoundingClientRect();
          return {
            tag:  el.tagName.toLowerCase(),
            ph:   el.getAttribute('placeholder') || '',
            name: el.getAttribute('name') || '',
            id:   el.id || '',
            fcn:  el.getAttribute('formcontrolname') || '',
            aria: el.getAttribute('aria-label') || '',
            type: el.getAttribute('type') || '',
            text: (el.textContent || '').trim().slice(0, 40),
            vis:  r.width > 0 && r.height > 0,
          };
        };
        return Array.from(document.querySelectorAll('input, button, mat-select'))
          .map(pick)
          .filter((c) => c.vis);
      });

      controls.forEach((c, i) => {
        console.log(
          `[${i}] <${c.tag}> type="${c.type}" placeholder="${c.ph}" ` +
          `name="${c.name}" id="${c.id}" formcontrolname="${c.fcn}" ` +
          `aria-label="${c.aria}" text="${c.text}"`
        );
      });
      console.log('');
    } catch (err) {
      console.error('  evaluate failed:', err.message);
    }
  }

  // Do NOT call browser.close() — it would close your Chrome over CDP.
  console.log('Done. (Chrome left open.)');
  process.exit(0);
})();
