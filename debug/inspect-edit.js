/**
 * Inspects the "Edit" controls inside each expanded passenger card so we can
 * tell the Personal-details Edit apart from the Alfursan/Frequent-flyer Edit
 * (the latter opens a Login modal and must NOT be clicked).
 *
 * Usage (Chrome on the debug port, a booking page open with a card EXPANDED):
 *     node debug/inspect-edit.js          # port 9222
 *     node debug/inspect-edit.js 9223
 *
 * Never calls browser.close() — it only detaches.
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
      const edits = await page.evaluate(() => {
        // Build a short DOM-path for an element (tag + nth-of-type chain, 5 deep).
        const pathOf = (el) => {
          const seg = [];
          let n = el;
          for (let i = 0; i < 5 && n && n.nodeType === 1; i++) {
            let s = n.tagName.toLowerCase();
            if (n.id) s += `#${n.id}`;
            const cls = (n.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
            if (cls.length) s += '.' + cls.join('.');
            seg.unshift(s);
            n = n.parentElement;
          }
          return seg.join(' > ');
        };

        // Every element whose OWN text is exactly "Edit".
        const all = Array.from(document.querySelectorAll('a, button, span, div'));
        const editEls = all.filter((el) => (el.textContent || '').trim() === 'Edit');

        return editEls.map((el) => {
          const r = el.getBoundingClientRect();
          // Walk up a few ancestors and grab the row label text to classify it.
          let label = '';
          let n = el;
          for (let i = 0; i < 6 && n; i++) {
            const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
            if (/personal details|alfursan|frequent flyer|miles/i.test(t)) { label = t.slice(0, 80); break; }
            n = n.parentElement;
          }
          return {
            tag:    el.tagName.toLowerCase(),
            id:     el.id || '',
            cls:    el.getAttribute('class') || '',
            href:   el.getAttribute('href') || '',
            aria:   el.getAttribute('aria-label') || '',
            role:   el.getAttribute('role') || '',
            vis:    r.width > 0 && r.height > 0,
            label,
            path:   pathOf(el),
          };
        });
      });

      if (!edits.length) {
        console.log('  (no exact-"Edit" elements found — is a passenger card expanded?)\n');
        continue;
      }
      edits.forEach((e, i) => {
        const kind = /alfursan|frequent flyer|miles/i.test(e.label) ? '🟥 FF/Alfursan'
                   : /personal details/i.test(e.label) ? '🟩 Personal details'
                   : '❓ unknown';
        console.log(`[${i}] ${kind}  vis=${e.vis}`);
        console.log(`     <${e.tag}> id="${e.id}" role="${e.role}" aria="${e.aria}" href="${e.href}"`);
        console.log(`     class="${e.cls}"`);
        console.log(`     label="${e.label}"`);
        console.log(`     path = ${e.path}`);
      });
      console.log('');
    } catch (err) {
      console.error('  evaluate failed:', err.message);
    }
  }

  console.log('Done. (Chrome left open.)');
  process.exit(0);
})();
