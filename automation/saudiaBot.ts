import type { Page, Locator } from 'playwright-core';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FlightLeg {
  date: string;   // normalised: DD-Mon-YYYY
  from: string;   // 3-letter IATA code
  to:   string;
}

export interface PassengerData {
  pnr:            string;
  fullName:       string;
  lastName:       string;
  flights:        FlightLeg[];   // [0]=first, [1]=second, [2]=third, [3]=fourth
  ffNumber:       string;
  travelClass:    string;
  ticketNumber:   string;
  passportNumber: string;
  status:         'done' | 'no-passport' | 'skipped';
  skipReason:     string;
}

export type LogFn = (msg: string) => void;

/** Returns true to continue, false to stop. Waits if paused. */
export type PauseCheckFn = () => Promise<boolean>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function humanDelay(min = 150, max = 350): Promise<void> {
  return delay(min + Math.random() * (max - min));
}

/** Normalise various date strings to DD-Mon-YYYY */
function normaliseDate(raw: string): string {
  if (!raw) return '';
  const months: Record<string, string> = {
    january: 'Jan', february: 'Feb', march:    'Mar', april:    'Apr',
    may:     'May', june:     'Jun', july:     'Jul', august:   'Aug',
    september:'Sep',october:  'Oct', november: 'Nov', december: 'Dec',
    jan:'Jan', feb:'Feb', mar:'Mar', apr:'Apr',
    jun:'Jun', jul:'Jul', aug:'Aug',
    sep:'Sep', oct:'Oct', nov:'Nov', dec:'Dec',
  };
  const m = raw.match(
    /(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:[,\s]+(\d{4}))?/i
  );
  if (m) {
    const day = m[1].padStart(2, '0');
    const mon = months[m[2].toLowerCase()] ?? m[2];
    const yr  = m[3] ?? new Date().getFullYear().toString();
    return `${day}-${mon}-${yr}`;
  }
  return raw.trim();
}

// Airport codes to skip (titles, status codes, weekday abbreviations, currencies, UI text)
const NOT_AIRPORT = new Set([
  // Titles & status
  'MRS','MR','MS','DR','THE','AND','FOR','ADT','CHD','INF',
  // Airline codes
  'HK','SV','EY','QR','EK','AA','BA','LH','TK','MS','WY',
  // Weekdays
  'THU','FRI','SAT','SUN','MON','TUE','WED',
  // Months
  'JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC',
  // Currency codes (commonly seen on Saudia pages)
  'USD','EUR','GBP','SAR','AED','CAD','INR','PKR','BDT','EGP','QAR',
  'KWD','BHD','OMR','JOD','TRY','MYR','SGD','AUD','NZD','ZAR','KES',
  'NGN','LKR','NPR','PHP','IDR','THB','VND','KRW','JPY','CNY','HKD',
  // UI text fragments that are 3 uppercase letters
  'ADD','GET','ALL','NEW','VIA','TAX','FEE','PER','DAY','NOW',
]);

function extractAirports(text: string): string[] {
  return (text.match(/\b([A-Z]{3})\b/g) ?? []).filter(c => !NOT_AIRPORT.has(c));
}

// ── Tab identification ────────────────────────────────────────────────────────

// ── Universal modal escape ───────────────────────────────────────────────────

/**
 * Detects and closes ANY open modal/dialog on the page, or navigates back
 * if the page accidentally navigated to the login page (/socialLogin).
 * Call this before interacting with page elements to ensure nothing is blocking.
 * Returns true if something was closed / navigated back.
 */
async function closeAnyOpenModal(page: Page, log: LogFn): Promise<boolean> {
  try {
    // ── Check 1: Did we accidentally navigate to the login page? ──────────
    // The Saudia "Login" button navigates to /socialLogin — it's a full page,
    // NOT a dialog.  The close button is <a class="close-icon">.
    const url = page.url();
    if (url.includes('socialLogin') || url.includes('login')) {
      log('   🔒 Login page detected — navigating back');
      // Try clicking the close-icon link first
      try {
        await page.locator('a.close-icon').first().click({ timeout: 2000 });
        await delay(300);
        if (!page.url().includes('login')) {
          log('   ✓ Back to booking page via close-icon');
          return true;
        }
      } catch { /* fallback below */ }
      // Fallback: browser back button
      try {
        await page.goBack({ timeout: 5000 });
        await delay(300);
        log('   ✓ Back to booking page via history.back()');
        return true;
      } catch { /* give up */ }
    }

    // ── Check 2: Any visible [role="dialog"] ─────────────────────────────
    const count = await page.locator('[role="dialog"]').count();
    if (count === 0) return false;

    const allDlgs = await page.locator('[role="dialog"]').all();
    for (const dlg of allDlgs) {
      if (!(await dlg.isVisible().catch(() => false))) continue;

      log('   🔒 Stale modal detected — closing');

      // Strategy 0: confirmed working selector from Playwright Inspector
      const closeBtn = page.getByLabel('Close', { exact: true });
      if (await closeBtn.isVisible({ timeout: 800 }).catch(() => false)) {
        await closeBtn.click();
        await page.waitForTimeout(500);
        const stillVisible = await page.locator('[role="dialog"]').isVisible({ timeout: 500 }).catch(() => false);
        if (!stillVisible) return true;
      }

      const strategies: Array<() => Promise<void>> = [
        () => dlg.locator('a.close-icon').first().click({ timeout: 300 }),
        () => dlg.locator('button:has-text("close")').first().click({ timeout: 300 }),
        () => dlg.locator('button[aria-label*="close" i]').first().click({ timeout: 300 }),
        () => dlg.getByRole('button', { name: /cancel/i }).first().click({ timeout: 300 }),
        () => dlg.getByRole('button', { name: /^[×✕✖xX]$/i }).first().click({ timeout: 300 }),
        () => dlg.locator('button').first().click({ timeout: 300 }),
        () => page.keyboard.press('Escape'),
        async () => { await delay(75); await page.keyboard.press('Escape'); },
      ];
      for (const fn of strategies) {
        try {
          await fn();
          await delay(100);
          if (!(await dlg.isVisible({ timeout: 200 }).catch(() => false))) {
            log('   ✓ Modal closed');
            return true;
          }
        } catch { /* try next */ }
      }
      // Last resort: triple Escape
      await page.keyboard.press('Escape');
      await delay(75);
      await page.keyboard.press('Escape');
      await delay(75);
      await page.keyboard.press('Escape');
      log('   ✓ Modal closed (Escape fallback)');
      return true;
    }
  } catch { /* no modal */ }
  return false;
}

/** True when the URL is a Saudia manage-my-booking page */
export function isSaudiaTab(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes('saudia.com') && (
    lower.includes('managemybooking') ||
    lower.includes('manage-my-booking') ||
    lower.includes('manage-booking') ||
    lower.includes('booking-details') ||
    lower.includes('trip-details')
  );
}

/** Convenience overload that accepts a Page object */
export function isSaudiaBookingPage(page: Page): boolean {
  return isSaudiaTab(page.url());
}

/**
 * Gets the real URL from a page — works even when page.url() is empty
 * (which happens for all pre-existing tabs in a connectOverCDP session).
 */
export async function getPageUrl(page: Page): Promise<string> {
  const cached = page.url();
  if (cached && cached !== 'about:blank') return cached;
  try { return await page.evaluate(() => window.location.href); }
  catch { return ''; }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/** Default no-op pause check (always continue) */
const NO_PAUSE: PauseCheckFn = async () => true;

export async function extractTabData(
  page: Page,
  log: LogFn,
  pauseCheck: PauseCheckFn = NO_PAUSE,
  knownUrl?: string          // URL from HTTP scan — avoids evaluate() before bringToFront
): Promise<PassengerData[]> {
  // Use the known URL from HTTP scan if provided (always correct).
  // Only fall back to page.url() / evaluate() if no knownUrl was supplied.
  // IMPORTANT: never call evaluate() on a background tab that hasn't been
  // brought to front — it can hang indefinitely with no timeout.
  let url = knownUrl || page.url();

  log(`📄 Tab URL: ${url || '(empty)'}`);

  if (!isSaudiaTab(url)) {
    log('⏭  Not a Saudia managemybooking page — skipping');
    return [];
  }

  try {
    // Page is already loaded (pre-existing tab) — skip waitForLoadState
    // to avoid false timeouts on tabs that missed their load event.
    await delay(50);

    // ── PNR ──────────────────────────────────────────────────────────────────
    const pnr = await extractPnr(page, log);
    log(`🔑 PNR: ${pnr || '(not found)'}`);

    // ── Flights ───────────────────────────────────────────────────────────────
    const flights = await extractFlights(page, log);
    log(`✈  Legs found: ${flights.length}`);
    flights.forEach((f, i) => log(`   Leg ${i + 1}: ${f.date}  ${f.from} → ${f.to}`));

    // ── Passengers ────────────────────────────────────────────────────────────
    const passengers = await extractAllPassengers(page, pnr, flights, log, pauseCheck);
    log(`👥 Passengers extracted: ${passengers.length}`);

    return passengers;
  } catch (err) {
    log(`❌ Tab failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// ── PNR extraction ────────────────────────────────────────────────────────────

async function extractPnr(page: Page, log: LogFn): Promise<string> {
  // Strategy 1: "Booking reference\n8UDBSN" pattern in body text
  try {
    const body = await page.locator('body').innerText({ timeout: 2000 });
    const m = body.match(/Booking\s+reference\s*\n?\s*([A-Z0-9]{6})\b/i);
    if (m) return m[1].toUpperCase();
  } catch { /* continue */ }

  // Strategy 2: sibling/parent of the "Booking reference" label element
  try {
    const label = page.getByText(/^Booking reference$/i).first();
    const parent = label.locator('xpath=../..').first();
    const text = await parent.innerText({ timeout: 1000 });
    const m = text.match(/\b([A-Z0-9]{6})\b/);
    if (m) return m[1];
  } catch { /* continue */ }

  // Strategy 3: URL params
  const urlMatch = page.url().match(/[?&/](?:pnr|ref|booking)[=:/]?([A-Z0-9]{6})/i);
  if (urlMatch) {
    log('   PNR found in URL');
    return urlMatch[1].toUpperCase();
  }

  log('   ⚠️  PNR not found');
  return '';
}

// ── Flight extraction ─────────────────────────────────────────────────────────

async function extractFlights(page: Page, log: LogFn): Promise<FlightLeg[]> {
  const legs: FlightLeg[] = [];

  try {
    const body = await page.locator('body').innerText();
    const lines = body.split('\n');

    // ── Strategy 1: "Flight N·Day, DD Month" blocks ─────────────────────
    // The Saudia page renders flights as:
    //   "Flight 1·Sat, 04 April Departed"   ← flight header with date
    //   "DXB"                                ← FROM airport code (next line)
    //   "11:10"                              ← departure time
    //   ... (Non-stop / 1 Stop / duration / circle / flight) ...
    //   "JED"                                ← TO airport code (line after "flight")
    //   "13:05"                              ← arrival time
    for (let li = 0; li < lines.length && legs.length < 4; li++) {
      const headerMatch = lines[li].match(
        /Flight\s+\d+\s*[·.]\s*(?:\w+,\s*)?(\d{1,2}\s+\w+(?:\s+\d{4})?)/i
      );
      if (!headerMatch) continue;

      const date = normaliseDate(headerMatch[1]);
      let from = '';
      let to   = '';

      // FROM = first 3-letter airport code in the lines following the header
      for (let j = li + 1; j < Math.min(li + 4, lines.length); j++) {
        const code = lines[j].trim();
        if (/^[A-Z]{3}$/.test(code) && !NOT_AIRPORT.has(code)) {
          from = code;
          break;
        }
      }

      // TO = first 3-letter airport code AFTER the "flight" keyword line
      for (let j = li + 1; j < Math.min(li + 15, lines.length); j++) {
        if (lines[j].trim().toLowerCase() === 'flight') {
          // Next line(s) after "flight" should be the TO code
          for (let k = j + 1; k < Math.min(j + 3, lines.length); k++) {
            const code = lines[k].trim();
            if (/^[A-Z]{3}$/.test(code) && !NOT_AIRPORT.has(code)) {
              to = code;
              break;
            }
          }
          break;
        }
      }

      if (from || to) {
        legs.push({ date, from, to });
        log(`   Flight block: "${lines[li].trim().slice(0, 60)}" → ${from} → ${to}`);
      }
    }

    // ── Strategy 2 (fallback): "Departing/Returning" blocks ──────────────
    if (legs.length === 0) {
      log('   ⚠️  No "Flight N" blocks — trying Departing/Returning pattern');
      const blockRe = /(?:Departing|Returning)\s*[·•\-]\s*(?:\w+,\s*)?(\d{1,2}(?:st|nd|rd|th)?\s+\w+(?:\s+\d{4})?)/gi;
      let m: RegExpExecArray | null;
      while ((m = blockRe.exec(body)) !== null) {
        const date    = normaliseDate(m[1]);
        const chunk   = body.slice(m.index, m.index + 500);
        const airports = extractAirports(chunk);
        const from = airports[0] ?? '';
        const to   = airports.length >= 2 ? airports[1] : '';
        legs.push({ date, from, to });
        if (legs.length >= 4) break;
      }
    }

    // ── Strategy 3 (last resort): generic date + airport codes ───────────
    if (legs.length === 0) {
      log('   ⚠️  No Departing/Returning — trying generic date pattern');
      const genericRe = /(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s+\d{4})?)/gi;
      let gm: RegExpExecArray | null;
      while ((gm = genericRe.exec(body)) !== null && legs.length < 4) {
        const date = normaliseDate(gm[1]);
        const chunk = body.slice(gm.index, gm.index + 300);
        const airports = extractAirports(chunk);
        if (airports.length >= 2) {
          legs.push({ date, from: airports[0], to: airports[1] });
        }
      }
    }
  } catch (err) {
    log(`   ⚠️  Flight extraction error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return legs;
}

// ── Passenger extraction ──────────────────────────────────────────────────────

/**
 * Finds the ▼ expand buttons using multiple strategies.
 * Saudia pages sometimes use aria-expanded, sometimes Material Icons font text.
 */
async function findExpandButtons(page: Page, log: LogFn): Promise<Locator[]> {
  const strategies: { sel: string; label: string }[] = [
    { sel: 'button[aria-expanded]',               label: 'aria-expanded'          },
    { sel: 'button:has-text("expand_more")',       label: 'expand_more icon text'  },
    { sel: 'button:has-text("keyboard_arrow_down")',label: 'keyboard_arrow_down'  },
    { sel: 'button:has-text("chevron_down")',      label: 'chevron_down'           },
  ];

  for (const { sel, label } of strategies) {
    try {
      const btns = await page.locator(sel).all();
      if (btns.length > 0) {
        log(`   Expand button strategy: "${label}" → ${btns.length} found`);
        return btns;
      }
    } catch { /* try next */ }
  }

  return [];
}

/**
 * Fallback: count passengers by matching title+name patterns in body text.
 * Returns deduplicated list of full names found.
 */
async function getPassengerNamesFromBody(page: Page, log: LogFn): Promise<string[]> {
  try {
    const body = await page.locator('body').innerText();
    const names: string[] = [];

    // Garbage prefixes that can bleed into name matches
    const GARBAGE_RE = /^(?:View\s+extras|Add\s+frequent\s+flyer(?:\s+number)?|airline_seat[_a-z]*|add_circle|done_all|description|luggage|chevron_right|info)\s*/i;

    const addName = (n: string) => {
      // Strip any garbage prefix that got captured
      let name = n.replace(GARBAGE_RE, '').trim();
      // Strip "Edit\n", "number\n", "Update\n" line prefixes that bleed
      // from adjacent UI elements across line boundaries
      name = name.replace(/^(?:Edit|number|Update)\s*[\n\r]+\s*/i, '');
      // Strip leading newlines / whitespace
      name = name.replace(/^[\n\r\s]+/, '').trim();
      if (name && name.length > 2 && !names.some(x => x.toLowerCase() === name.toLowerCase())) {
        names.push(name);
      }
    };

    // Pass 1: names WITH title — "Ms. Manal Alhazani · Adult" / "Mstr. Yaseen · Child"
    const re1 = new RegExp(
      `((?:${TITLE_PATTERN})\\.?\\s+[\\w][\\w\\s\\-']+?)\\s*[·.\\u00B7]\\s*(?:Adult(?:\\s+with\\s+Infant)?|Child|Infant)`,
      'gi'
    );
    let m: RegExpExecArray | null;
    while ((m = re1.exec(body)) !== null) addName(m[1]);

    // Pass 2: names WITHOUT title — "Muhammad Nabhan · Adult"
    // Only match lines that start with a capital letter followed by at least
    // one more word, ending at the · Adult/Child/Infant marker.
    const re2 = /^([A-Z][a-zA-Z]+(?:\s+[A-Za-z][a-zA-Z\-']+)+)\s*[·.\u00B7]\s*(?:Adult(?:\s+with\s+Infant)?|Child|Infant)/gmi;
    while ((m = re2.exec(body)) !== null) addName(m[1]);

    log(`   Name scan: ${names.length} found → ${names.map(n => `"${n}"`).join(', ')}`);
    return names;
  } catch {
    return [];
  }
}

async function extractAllPassengers(
  page:       Page,
  pnr:        string,
  flights:    FlightLeg[],
  log:        LogFn,
  pauseCheck: PauseCheckFn = NO_PAUSE
): Promise<PassengerData[]> {
  const results: PassengerData[] = [];

  // ── Count passengers ──────────────────────────────────────────────────────────
  // Primary: body-text name scan (reliable, unaffected by DOM state)
  const names = await getPassengerNamesFromBody(page, log);
  let count   = names.length;

  // Fallback: expand-button count
  if (count === 0) {
    const btns = await findExpandButtons(page, log);
    count = btns.length;
    if (count > 0) log(`   Expand-button count used as fallback: ${count}`);
  }

  log(`   Passenger count: ${count}`);

  if (count === 0) {
    log('   ⚠️  No passengers found — dumping first 2000 chars for diagnosis');
    const snippet = (await page.locator('body').innerText().catch(() => '')).slice(0, 2000);
    log(snippet);
    return [];
  }

  // ── Process each passenger ────────────────────────────────────────────────────
  for (let i = 0; i < count; i++) {
    const name = names[i] ?? '';

    // ── Pause / Stop check between passengers ──────────────────────────────
    const shouldContinue = await pauseCheck();
    if (!shouldContinue) {
      log('🛑 Stopped by user mid-tab');
      break;
    }

    log(`\n   ──── Passenger ${i + 1} / ${count}${name ? ': ' + name : ''} ────`);

    try {
      // ── PRE-CHECK: close any stale modal from previous passenger ──────────
      await closeAnyOpenModal(page, log);

      // ── STEP A: Open this passenger's card ─────────────────────────────────
      if (name) {
        await clickPassengerCardOpen(page, name, log);
      } else {
        await clickExpandButton(page.locator('body'), page, i, log);
      }

      // ── STEP B: Get card root scoped to this passenger ─────────────────────
      let card: Locator;
      if (name) {
        card = await getCardByPassengerName(page, name, log);
      } else {
        const btns = await findExpandButtons(page, log);
        const anchor = btns[i] ?? btns[0];
        card = await getPassengerCardRoot(anchor, log);
      }

      // Diagnostic: log first 400 chars of card text so we can verify boundary
      try {
        const cardSnippet = (await card.innerText({ timeout: 500 })).slice(0, 400).replace(/\n+/g, ' ');
        log(`   Card text preview: "${cardSnippet}"`);
      } catch { /* non-fatal */ }

      // ── STEP B2: Click ▼ within this card to reveal e-ticket section ────────
      // Name click (Step A) opens the card header; ▼ reveals the deeper content
      // (flights, "View E-ticket & receipts").  Card-scoped click = no index drift.
      await clickExpandButton(card, page, i, log);

      // ── STEP C: Extract all data ────────────────────────────────────────────
      let fullName      = await extractFullName(card, log);

      // Verify extracted name matches body-scan name — card may be too broad
      if (fullName && name) {
        const titleStripRe2 = new RegExp(`^(?:${TITLE_PATTERN})\\.?\\s+`, 'i');
        const fnStripped = fullName.replace(titleStripRe2, '').trim().toLowerCase();
        const nameStripped = name.replace(titleStripRe2, '').trim().toLowerCase();
        const nameWords = nameStripped.split(/\s+/).filter((w: string) => w.length > 2);
        const hasOverlap = nameWords.some((w: string) => fnStripped.includes(w));
        if (!hasOverlap) {
          log(`   ⚠️  Name mismatch: extracted "${fullName}" vs expected "${name}" — using body-scan name`);
          fullName = name;
        }
      }

      const ffNumber      = await extractFFNumber(card, log);
      const { lastName, passportNumber } = await extractPersonalDetails(card, page, fullName || name, log);
      const { ticketNumber, travelClass } = await extractEticket(page, card, i, fullName || name, log);

      const resolvedLastName = lastName || parseLastName(fullName || name);
      const status: PassengerData['status'] = passportNumber ? 'done' : 'no-passport';

      results.push({
        pnr,
        fullName:       fullName || name,
        lastName:       resolvedLastName,
        flights,
        ffNumber,
        travelClass,
        ticketNumber,
        passportNumber,
        status,
        skipReason: '',
      });

      log(`   ✅ ${fullName || name} | ticket: ${ticketNumber || 'n/a'} | PP: ${passportNumber ? '***' + passportNumber.slice(-3) : 'none'} | class: ${travelClass || 'n/a'}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      let reason = errMsg;
      if (/timeout/i.test(errMsg)) {
        if (/dialog|modal/i.test(errMsg))        reason = 'Modal/dialog timeout — modal never appeared';
        else if (/edit|button/i.test(errMsg))    reason = 'Edit button timeout — element not clickable or not found';
        else if (/expand|arrow|accordion/i.test(errMsg)) reason = 'Card expand timeout — card did not open';
        else if (/visible|attached/i.test(errMsg))       reason = 'Element not visible — page layout may have changed';
        else                                             reason = `Timeout — ${errMsg.slice(0, 100)}`;
      }
      log(`   ❌ Passenger ${i + 1} skipped — Reason: ${reason}`);
      await page.keyboard.press('Escape').catch(() => {});
      await delay(100);
      await page.keyboard.press('Escape').catch(() => {});
    }

    await delay(50);
  }

  return results;
}

// ── Open card by clicking passenger name ──────────────────────────────────────

/**
 * Clicks a passenger's name text to open their accordion card.
 * The Saudia page uses a single-open accordion: clicking any name
 * auto-closes the previous card and opens the clicked one.
 * This avoids all index-drift issues with the ▼ button approach.
 */
async function clickPassengerCardOpen(page: Page, name: string, log: LogFn): Promise<void> {
  // Helper: check if the card is expanded (has visible e-ticket link or Personal details Edit)
  const isCardOpen = async (): Promise<boolean> => {
    try {
      const card = await getCardByPassengerName(page, name, log);
      const text = await card.innerText({ timeout: 500 }).catch(() => '');
      // An expanded card shows "View E-ticket & receipts" or the ▼ section content
      return text.includes('View E-ticket') || text.includes('Personal details') || text.includes('Missing Details');
    } catch { return false; }
  };

  const clickStrategies: Array<() => Promise<void>> = [
    // Click directly on the name text
    async () => {
      const el = page.getByText(name, { exact: false }).first();
      await el.waitFor({ state: 'visible', timeout: 1000 });
      await el.click({ timeout: 1000 });
    },
    // Click parent element (name is usually inside a <span> inside a clickable <div>)
    async () => {
      const el = page.getByText(name, { exact: false }).first();
      await el.locator('xpath=..').click({ timeout: 1000 });
    },
    // Click grandparent
    async () => {
      const el = page.getByText(name, { exact: false }).first();
      await el.locator('xpath=../..').click({ timeout: 1000 });
    },
  ];

  for (const fn of clickStrategies) {
    try {
      await fn();
      log(`   ▼ Name clicked: "${name}"`);
      await delay(100);

      // Verify the card is actually OPEN after clicking.
      // The accordion is a toggle — if the card was already open, clicking
      // the name CLOSED it.  Detect this and click again to reopen.
      const open = await isCardOpen();
      if (!open) {
        log('   ⚠️  Card closed after click (was already open) — clicking again to reopen');
        await fn();
        await delay(100);
      }
      return;
    } catch { /* try next */ }
  }

  // Final fallback: ▼ expand button scoped to the card containing this name
  log(`   ⚠️  Name click failed — trying expand button fallback`);
  try {
    const card = await getCardByPassengerName(page, name, log);
    await card.locator('button[aria-expanded], button:has-text("expand_more"), button:has-text("keyboard_arrow_down")').first().click({ timeout: 1000 });
    log('   ▼ Card opened via expand button fallback');
    await delay(100);
  } catch (err) {
    log(`   ⚠️  All card-open strategies failed for "${name}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Expand card ───────────────────────────────────────────────────────────────

/**
 * Clicks the ▼ button for this passenger's card.
 * IMPORTANT: card-scoped strategies run FIRST.
 * Page-level index strategies are unreliable because after pax[0]'s button is
 * clicked it changes state (expand_more → expand_less), shrinking the index-0
 * list and causing pax[1] to resolve to pax[2]'s button, etc.
 */
async function clickExpandButton(
  card:  Locator,
  page:  Page,
  index: number,
  log:   LogFn
): Promise<void> {
  const strategies: Array<() => Promise<void>> = [
    // ── Card-scoped (most reliable — unaffected by other cards' state) ──────
    () => card.locator('button[aria-expanded="false"]').first().click({ timeout: 400 }),
    () => card.locator('button[aria-expanded]').first().click({ timeout: 400 }),
    () => card.locator('button:has-text("expand_more")').first().click({ timeout: 400 }),
    () => card.locator('button:has-text("keyboard_arrow_down")').first().click({ timeout: 400 }),
    () => card.locator('button').last().click({ timeout: 400 }),
    // ── Page-level by index (fallback only) ──────────────────────────────────
    async () => {
      const btns = await page.locator('button[aria-expanded]').all();
      if (!btns[index]) throw new Error('not found');
      await btns[index].click({ timeout: 400 });
    },
    async () => {
      const btns = await page.locator('button:has-text("expand_more")').all();
      if (!btns[index]) throw new Error('not found');
      await btns[index].click({ timeout: 400 });
    },
    async () => {
      const btns = await page.locator('button:has-text("keyboard_arrow_down")').all();
      if (!btns[index]) throw new Error('not found');
      await btns[index].click({ timeout: 400 });
    },
  ];

  for (const fn of strategies) {
    try {
      await fn();
      log('   ▼ Card expanded');
      await delay(100);
      return;
    } catch { /* try next */ }
  }

  log('   ⚠️  Could not click expand button — card may already be open or button not found');
}

// ── Card root locators ────────────────────────────────────────────────────────

/**
 * Walks up from the ▼ expand button to find the individual passenger card.
 * Uses "exactly 1 Personal details" as the boundary — so we never land on
 * the whole Passengers & Extras section (which has 3+).
 */
async function getPassengerCardRoot(link: Locator, log: LogFn): Promise<Locator> {
  for (const depth of [3, 4, 5, 6, 7]) {
    try {
      const ancestor = link.locator(`xpath=ancestor::div[${depth}]`).first();
      const text     = await ancestor.innerText({ timeout: 300 });
      const pdCount  = (text.match(/Personal details|Missing Details/gi) ?? []).length;
      if (pdCount === 1) return ancestor;
    } catch { /* try deeper */ }
  }
  log('   ⚠️  Card root not found — using 4 levels up');
  return link.locator('xpath=ancestor::div[4]').first();
}

/**
 * Finds the card for a passenger by name when no expand button exists.
 * Finds the SMALLEST ancestor div containing the name AND exactly 1
 * "Personal details" — the individual card boundary.
 */
async function getCardByPassengerName(page: Page, name: string, log: LogFn): Promise<Locator> {
  try {
    const nameEls = await page.getByText(name, { exact: false }).all();
    for (const el of nameEls) {
      for (const depth of [2, 3, 4, 5, 6]) {
        try {
          const anc     = el.locator(`xpath=ancestor::div[${depth}]`).first();
          const text    = await anc.innerText({ timeout: 300 });
          const pdCount = (text.match(/Personal details|Missing Details/gi) ?? []).length;
          if (pdCount === 1) {
            log(`   Card for "${name}" at depth ${depth}`);
            return anc;
          }
        } catch { /* try deeper */ }
      }
    }
  } catch { /* fall through */ }

  log(`   ⚠️  Fallback card depth 4 for "${name}"`);
  return page.getByText(name, { exact: false }).first().locator('xpath=ancestor::div[4]').first();
}

// ── Name extraction ───────────────────────────────────────────────────────────

// All title prefixes used in airline bookings (male, female, child, professional)
const TITLE_PATTERN =
  'Mr|Mrs|Ms|Miss|Mstr|Master|Mst|Mx|' +   // standard + gender-neutral
  'Dr|Prof|Professor|Rev|Reverend|' +        // professional / religious
  'Sir|Lady|Lord|Dame|' +                    // honorific
  'Capt|Captain|Col|Colonel|Gen|General|' +  // military
  'Inf|Infant|Baby';                         // infant/child codes

const TITLE_RE = new RegExp(
  `^((?:${TITLE_PATTERN})\\.?\\s+[^\\n·•]+?)(?:\\s*[·•]|\\s*\\n)`,
  'mi'
);

async function extractFullName(card: Locator, log: LogFn): Promise<string> {
  try {
    let text = await card.innerText({ timeout: 1000 });
    // Strip UI garbage that can prefix or suffix the name
    text = text.replace(/(?:View\s+extras|Add\s+frequent\s+flyer\s+number|airline_seat[_a-z]*|add_circle|done_all|description|luggage|chevron_right|info)\s*/gi, ' ');
    // Format: "Mr. Ahmed Alameer · Adult" / "Mstr. Yaseen · Child" / "Prof. Smith · Adult"
    const m = text.match(TITLE_RE);
    if (m) {
      const name = m[1].trim();
      log(`   Name: ${name}`);
      return name;
    }
    // Fallback — name without a recognised title (e.g. "Abdullah Almineefi · Adult")
    const m2 = text.match(/^([A-Z][a-zA-Z\s\-']+?)(?:\s*[·•]|\s*\n)/m);
    if (m2) {
      const name = m2[1].trim();
      log(`   Name (no title): ${name}`);
      return name;
    }
  } catch (err) {
    log(`   ⚠️  Name extraction failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  log('   ⚠️  Name not found');
  return '';
}

// ── Frequent Flyer extraction ─────────────────────────────────────────────────

async function extractFFNumber(card: Locator, log: LogFn): Promise<string> {
  try {
    const text = await card.innerText({ timeout: 800 });

    if (text.toLowerCase().includes('add frequent flyer')) {
      log('   FF: none');
      return '';
    }

    // Airline code prefix + digits e.g. "SV 78915244" or "SV1000470327"
    const m = text.match(/\b((?:SV|EY|QR|EK|AA|BA|LH|TK|WY|MS)\s?\d{6,12})\b/i);
    if (m) {
      log(`   FF: ${m[1].trim()}`);
      return m[1].trim();
    }

    // Generic digits near "frequent flyer"
    const m2 = text.match(/frequent\s+flyer[^0-9]{0,30}(\d{6,12})/i);
    if (m2) {
      log(`   FF: ${m2[1]}`);
      return m2[1];
    }
  } catch (err) {
    log(`   ⚠️  FF extraction failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return '';
}

// ── Personal Details (passport + last name) ───────────────────────────────────

async function extractPersonalDetails(
  card: Locator,
  page: Page,
  passengerName: string,
  log:  LogFn
): Promise<{ lastName: string; passportNumber: string }> {
  let lastName      = '';
  let passportNumber = '';

  try {
    // The card shows:  "✓ Personal details  Edit"   "Alfursan Miles · SV xxx  Edit"
    // We must click the Personal Details Edit, not the FF Edit.
    //
    // Strategy: find the INNERMOST element that contains "Personal details" text
    // (.last() = innermost in DOM order for :has-text()), walk up to its parent
    // row, and find an Edit button there.  This avoids the outer card container
    // matching :has-text() and accidentally returning pax1's Edit button.
    let editBtn: Locator | null = null;

    // ── Strategy 1: Walk ancestor depths from "Personal details" text ─────────
    // Tries depths 1-4 above the text node. At each level checks:
    //   (a) "Personal details" appears in the row text
    //   (b) NO Alfursan / Frequent Flyer text in the same row  ← key FF guard
    //   (c) a visible Edit button exists inside that row
    for (const depth of ['..', '../..', '../../..', '../../../..']) {
      if (editBtn) break;
      try {
        const row     = card.locator('text=Personal details').first().locator(`xpath=${depth}`);
        const rowText = await row.innerText({ timeout: 600 }).catch(() => '');
        if (
          /personal details/i.test(rowText) &&
          !/alfursan|frequent flyer|flyer miles|ff number/i.test(rowText)
        ) {
          const candidate = row.getByText('Edit', { exact: true }).first();
          if (await candidate.isVisible({ timeout: 600 }).catch(() => false)) {
            editBtn = candidate;
            log(`   Personal Details Edit found (ancestor ${depth})`);
          }
        }
      } catch { /* try deeper */ }
    }

    // ── Strategy 2: Scan every Edit button in the card; pick the one whose ────
    // nearest ancestor div exclusively contains "Personal details" context.
    if (!editBtn) {
      try {
        const allEdits = await card.getByText('Edit', { exact: true }).all();
        outer: for (const btn of allEdits) {
          for (const depth of [2, 3, 4, 5]) {
            try {
              const anc     = btn.locator(`xpath=ancestor::div[${depth}]`).first();
              const ancText = await anc.innerText({ timeout: 600 }).catch(() => '');
              if (
                /personal details/i.test(ancText) &&
                !/alfursan|frequent flyer/i.test(ancText)
              ) {
                editBtn = btn;
                log(`   Personal Details Edit found via button scan (div[${depth}])`);
                break outer;
              }
            } catch { /* try next depth */ }
          }
        }
      } catch { /* fall through */ }
    }

    // ── Strategy 3: "Missing Details" + "Update" (incomplete bookings) ────────
    if (!editBtn) {
      for (const depth of ['..', '../..', '../../..']) {
        if (editBtn) break;
        try {
          const row       = card.locator('text=Missing Details').first().locator(`xpath=${depth}`);
          const candidate = row.getByText('Update', { exact: true }).first();
          if (await candidate.isVisible({ timeout: 600 }).catch(() => false)) {
            editBtn = candidate;
            log('   Missing Details → Update button found');
          }
        } catch { /* try deeper */ }
      }
    }

    if (!editBtn) {
      log('   Reason: Personal details Edit button not found — passport extraction skipped');
      return { lastName, passportNumber };
    }

    // ── Click with open-close-reopen retry ────────────────────────────────────
    // If the first click opens the wrong modal (login page, or Alfursan account
    // dialog) close it immediately and click again.  The second open is reliable.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const ctx = await editBtn.locator('xpath=../..').innerText({ timeout: 600 }).catch(() => '');
        log(`   Edit btn context (attempt ${attempt}): "${ctx.slice(0, 100).replace(/\n+/g, ' ')}"`);
      } catch { /* non-fatal */ }

      await page.evaluate(() => {
        document.querySelectorAll('.cdk-overlay-backdrop').forEach(el => el.remove());
      });
      await page.waitForTimeout(300);

      await editBtn.click();
      log(`   Clicked Edit (attempt ${attempt})`);
      await delay(250);

      // Check if the wrong dialog opened
      try {
        const dlgCount = await page.locator('[role="dialog"]').count();
        if (dlgCount > 0) {
          const topText = await page.locator('[role="dialog"]').last()
            .innerText({ timeout: 1000 }).catch(() => '');
          const isWrong =
            /log\s*in|sign\s*in|email.*password|continue\s+with\s+google|alfursan\s+account/i.test(topText) &&
            !/edit passenger details/i.test(topText);
          if (isWrong && attempt === 1) {
            log('   ⚠️  Wrong modal (login/Alfursan) on first click — closing and retrying');
            await closeAnyOpenModal(page, log);
            await delay(100);
            continue; // retry click
          }
        }
      } catch { /* ignore check errors */ }

      break; // dialog looks correct (or none yet) — fall through to failsafes
    }

    // ── Failsafe: did clicking Edit navigate to the login page? ──────────
    if (page.url().includes('socialLogin') || page.url().includes('login')) {
      log('   Reason: Edit click navigated to login page (URL navigated away) — passport skipped');
      await closeAnyOpenModal(page, log);
      return { lastName, passportNumber };
    }

    // ── Wait for a dialog to appear — retry if needed ────────────────────────
    let dialogFound = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const count = await page.locator('[role="dialog"]').count();
      if (count > 0) { dialogFound = true; break; }
      log(`   Waiting for dialog to appear (attempt ${attempt + 1})...`);
      await delay(400);
    }
    if (!dialogFound) {
      log('   Reason: Personal details modal never opened after Edit click — passport skipped');
      return { lastName, passportNumber };
    }

    // ── Failsafe: detect and close wrong modals ───────────────────────────────
    // If a login / sign-in modal opened instead of the passenger details modal,
    // close it immediately and bail out of passport extraction.
    try {
      // Use the visible dialog only — closed modals linger in React DOM
      const modal = page.locator('[role="dialog"]:visible').last();
      const modalText = await modal.innerText({ timeout: 800 }).catch(() => '');
      log(`   Modal text (first 200): "${modalText.slice(0, 200).replace(/\n+/g, ' ')}"`);

      const isWrongModal =
        /log\s*in|sign\s*in|email.*password|password.*email|continue\s+with\s+google|continue\s+with\s+apple|forgot\s+password/i
          .test(modalText);

      if (isWrongModal) {
        log('   Reason: Wrong modal opened (login/sign-in instead of Edit passenger details) — passport skipped');
        for (const fn of [
          // The login modal typically has a × (cross) button in the top right
          () => modal.locator('button:has-text("close")').first().click({ timeout: 400 }),
          () => modal.locator('button[aria-label*="close" i]').first().click({ timeout: 400 }),
          () => modal.locator('button[aria-label*="dismiss" i]').first().click({ timeout: 400 }),
          () => modal.getByRole('button', { name: /close/i }).first().click({ timeout: 400 }),
          () => modal.getByRole('button', { name: /^[×✕✖xX]$/i }).first().click({ timeout: 400 }),
          // Click the first button in the modal (often the X close in top-right)
          () => modal.locator('button').first().click({ timeout: 400 }),
          () => page.keyboard.press('Escape'),
          async () => { await delay(75); await page.keyboard.press('Escape'); },
        ]) {
          try {
            await fn();
            await delay(150);
            // Verify it actually closed
            const stillOpen = await modal.isVisible({ timeout: 300 }).catch(() => false);
            if (!stillOpen) break;
          } catch { /* try next */ }
        }
        await delay(100);
        return { lastName, passportNumber }; // empty — continue with parseLastName fallback
      }
    } catch { /* modal not found or innerText failed — proceed normally */ }

    // ── Find the VISIBLE "Edit passenger details" dialog ────────────────────
    // Strategy: check [role="dialog"], then broader selectors for modals.
    // For each candidate, dump HTML tag + attributes + visibility for diagnosis.
    const allDialogs = await page.locator('[role="dialog"]').all();
    log(`   Diagnostic: ${allDialogs.length} [role="dialog"] elements in DOM`);

    let dlg: Locator | null = null;
    for (let di = 0; di < allDialogs.length; di++) {
      const vis = await allDialogs[di].isVisible().catch(() => false);
      // Dump outer HTML tag (first 300 chars) for structure diagnosis
      const outerHtml = await allDialogs[di].evaluate(
        (el: Element) => el.outerHTML.slice(0, 300)
      ).catch(() => '(no html)');
      const snippet = await allDialogs[di].innerText({ timeout: 400 }).catch(() => '');
      const hasEditPD = /edit passenger details/i.test(snippet);
      const inputVal = await allDialogs[di].locator('input').nth(1).inputValue().catch(() => '(none)');
      log(`   Dialog[${di}]: visible=${vis} | editPD=${hasEditPD} | input[1]="${inputVal}"`);
      log(`   Dialog[${di}] HTML: ${outerHtml.slice(0, 200).replace(/\n+/g, ' ')}`);
      log(`   Dialog[${di}] text: "${snippet.slice(0, 100).replace(/\n+/g, ' ')}"`);
      if (vis && hasEditPD) {
        dlg = allDialogs[di];
      }
    }

    // Fallback: if no [role="dialog"], check for other modal patterns
    if (!dlg) {
      log('   No [role="dialog"] match — checking alternative modal selectors...');
      const altSelectors = [
        '[class*="modal" i]',
        '[class*="dialog" i]',
        '[class*="overlay" i]',
        '[data-testid*="modal" i]',
        '[data-testid*="dialog" i]',
      ];
      for (const sel of altSelectors) {
        try {
          const els = await page.locator(sel).all();
          for (const el of els) {
            const vis = await el.isVisible().catch(() => false);
            if (!vis) continue;
            const txt = await el.innerText({ timeout: 400 }).catch(() => '');
            if (/edit passenger details/i.test(txt)) {
              log(`   Found modal via "${sel}" — using it`);
              dlg = el;
              break;
            }
          }
          if (dlg) break;
        } catch { /* skip */ }
      }
    }

    // Remove any lingering CDK overlay backdrop before extracting data
    await page.evaluate(() => {
      document.querySelectorAll('.cdk-overlay-backdrop').forEach(el => el.remove());
    });

    const dialog = page.locator('[role="dialog"]:visible').last();

    // Last resort: try to read inputs directly from the page if a form is visible
    if (!dlg) {
      log('   ⚠️  No modal found — trying direct page-level input read');
      // Check if there's a visible "Last name" input anywhere on the page
      try {
        const lnInput = dialog.getByLabel('Last name', { exact: false }).first();
        if (await lnInput.isVisible({ timeout: 400 }).catch(() => false)) {
          log('   Found visible "Last name" input on page — reading directly');
          lastName = await lnInput.inputValue({ timeout: 500 });
          log(`   Last name (page-level): "${lastName}"`);
        }
      } catch { /* nothing */ }
      try {
        const ppInput = dialog.getByLabel('Passport number', { exact: false }).first();
        if (await ppInput.isVisible({ timeout: 400 }).catch(() => false)) {
          passportNumber = await ppInput.inputValue({ timeout: 500 });
          log(`   Passport (page-level): ${passportNumber ? '***' + passportNumber.slice(-3) : '(blank)'}`);
        }
      } catch { /* nothing */ }

      // Close whatever opened
      await page.keyboard.press('Escape').catch(() => {});
      await delay(100);
      await page.keyboard.press('Escape').catch(() => {});
      return { lastName, passportNumber };
    }

    // ── Read inputs from the CORRECT form ──────────────────────────────────
    // The Saudia "Edit passenger details" dialog contains one <form> per
    // passenger (class="passenger-details-form").  ALL forms are inside a
    // single [role="dialog"].  We must find the form that belongs to THIS
    // passenger by matching the passenger's name against each form's
    // firstName + lastName input values.
    try {
      const formData = await page.evaluate((paxName: string) => {
        const allDlgEls = Array.from(document.querySelectorAll('[role="dialog"]'));
        const dlgEl = [...allDlgEls].reverse().find(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }) || allDlgEls[allDlgEls.length - 1];
        if (!dlgEl) return null;
        const forms = dlgEl.querySelectorAll('form');
        if (forms.length === 0) return null;

        const get = (form: Element, name: string) => {
          const inp = form.querySelector(`input[formcontrolname="${name}"]`) as HTMLInputElement | null;
          return inp?.value ?? '';
        };

        // Strip title prefix from the passenger name for matching
        // e.g. "Mrs. Fazila Imtiaz" → "Fazila Imtiaz"
        const nameClean = paxName
          .replace(/^(Mr|Mrs|Ms|Miss|Mstr|Master|Mst|Mx|Dr|Prof|Professor|Rev|Capt|Captain|Col|Gen|Sir|Lady|Lord|Dame|Inf|Infant|Baby)\.?\s+/i, '')
          .trim()
          .toLowerCase();

        // Try to match each form's firstName+lastName to the passenger name
        let matchedForm: Element | null = null;
        const formDetails: Array<{idx: number; fn: string; ln: string; pp: string; matched: boolean}> = [];

        for (let i = 0; i < forms.length; i++) {
          const fn = get(forms[i], 'firstName');
          const ln = get(forms[i], 'lastName');
          const pp = get(forms[i], 'passportNumber');
          const formFullName = `${fn} ${ln}`.toLowerCase().trim();

          // Match if the form's name is contained in the passenger name or vice versa
          const matched = nameClean.includes(formFullName) ||
                         formFullName.includes(nameClean) ||
                         nameClean.includes(fn.toLowerCase()) && nameClean.includes(ln.toLowerCase());

          formDetails.push({ idx: i, fn, ln, pp, matched });
          if (matched) matchedForm = forms[i];
        }

        // If no match found, fall back to the Edit button's aria-label
        if (!matchedForm) {
          const editBtns = dlgEl.querySelectorAll('button[aria-label*="click to edit"]');
          // The aria-labels correspond 1:1 with the forms
          for (let i = 0; i < editBtns.length && i < forms.length; i++) {
            const label = (editBtns[i].getAttribute('aria-label') || '').toLowerCase();
            if (label.includes(nameClean) || nameClean.split(' ').every(w => label.includes(w))) {
              matchedForm = forms[i];
              break;
            }
          }
        }

        if (!matchedForm) return { formCount: forms.length, formDetails, matched: false, firstName: '', lastName: '', passport: '' };

        return {
          formCount: forms.length,
          formDetails,
          matched: true,
          firstName: get(matchedForm, 'firstName'),
          lastName:  get(matchedForm, 'lastName'),
          passport:  get(matchedForm, 'passportNumber'),
        };
      }, passengerName);

      if (formData) {
        log(`   Dialog has ${formData.formCount} form(s) — match by name "${passengerName}"`);
        formData.formDetails?.forEach((fd: any) =>
          log(`   Form[${fd.idx}]: ${fd.fn} ${fd.ln} | PP: ${fd.pp ? '***' + fd.pp.slice(-3) : '(blank)'} | matched=${fd.matched}`)
        );
        if (formData.matched) {
          lastName       = formData.lastName;
          passportNumber = formData.passport;
          log(`   ✓ Last name: "${lastName}" | Passport: ${passportNumber ? '***' + passportNumber.slice(-3) : '(blank)'}`);
        } else {
          log('   ⚠️  No form matched passenger name — trying fallback');
        }
      } else {
        log('   ⚠️  Could not read form data via evaluate — trying fallback');
      }
    } catch (err) {
      log(`   ⚠️  Form evaluate failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Fallback: if evaluate didn't get data, try label-based approach
    if (!lastName) {
      try {
        lastName = await dlg.getByLabel('Last name', { exact: false })
          .inputValue({ timeout: 500 });
        log(`   Last name (label fallback): "${lastName}"`);
      } catch { log('   ⚠️  Last name not found via label either'); }
    }
    if (!passportNumber) {
      try {
        passportNumber = await dlg.getByLabel('Passport number', { exact: false })
          .inputValue({ timeout: 500 });
        log(`   Passport (label fallback): ${passportNumber ? '***' + passportNumber.slice(-3) : '(blank)'}`);
      } catch { /* skip */ }
    }

    // ── Close the modal (never Save Changes) ─────────────────────────────────
    // Saudia uses material icon font — the close button shows "close" as text
    const closeStrategies: Array<() => Promise<void>> = [
      () => dlg!.locator('button:has-text("close")').first().click({ timeout: 400 }),
      () => dlg!.getByRole('button', { name: /cancel/i }).first().click({ timeout: 400 }),
      () => dlg!.getByRole('button', { name: /close/i }).first().click({ timeout: 400 }),
      () => dlg!.locator('button[aria-label*="close" i]').first().click({ timeout: 400 }),
      () => dlg!.getByRole('button', { name: /^[×✕✖xX]$/i }).first().click({ timeout: 400 }),
      () => dlg!.locator('button').first().click({ timeout: 400 }),
      () => page.keyboard.press('Escape'),
      async () => { await delay(75); await page.keyboard.press('Escape'); },
    ];
    for (const fn of closeStrategies) {
      try {
        await fn();
        await delay(150);
        // Verify the modal is actually closed before moving on
        const stillVisible = await dlg!.isVisible({ timeout: 300 }).catch(() => false);
        if (!stillVisible) { log('   Closed modal'); break; }
      } catch { /* try next */ }
    }
    // Extra safety: if nothing worked, press Escape twice
    const finalCheck = await dlg!.isVisible({ timeout: 200 }).catch(() => false);
    if (finalCheck) {
      await page.keyboard.press('Escape');
      await delay(150);
      await page.keyboard.press('Escape');
      log('   Closed modal (Escape fallback)');
    }

    await delay(50);
  } catch (err) {
    log(`   ⚠️  Personal details error: ${err instanceof Error ? err.message : String(err)}`);
    // Emergency close
    await closeAnyOpenModal(page, log);
    await delay(75);
  }

  return { lastName, passportNumber };
}

// ── E-ticket extraction ───────────────────────────────────────────────────────

async function extractEticket(
  page:           Page,
  card:           Locator,
  passengerIndex: number,
  passengerName:  string,
  log:            LogFn
): Promise<{ ticketNumber: string; travelClass: string }> {
  let ticketNumber = '';
  let travelClass  = '';

  try {
    // Find "View E-ticket & receipts" — card-scoped first, page-level index fallback
    // Card-scoped is reliable; page-level index drifts as cards expand/collapse.
    let eticketLink: Locator | null = null;

    try {
      const cardLinks = await card.getByText('View E-ticket & receipts').all();
      if (cardLinks.length > 0) {
        eticketLink = cardLinks[0];
        log('   E-ticket link found within card');
      }
    } catch { /* fall through to page-level */ }

    if (!eticketLink) {
      // Saudia uses a single-open accordion — only ONE card is expanded at a time.
      // So there is always exactly ONE visible "View E-ticket & receipts" link,
      // regardless of how many passengers there are.  Find the first visible one.
      const allLinks = await page.getByText('View E-ticket & receipts').all();
      for (const link of allLinks) {
        if (await link.isVisible({ timeout: 500 }).catch(() => false)) {
          eticketLink = link;
          log('   E-ticket link: first visible on page (single-accordion strategy)');
          break;
        }
      }
    }

    if (!eticketLink) {
      log(`   Reason: "View E-ticket & receipts" link not found for passenger ${passengerIndex + 1} — ticket skipped`);
      return { ticketNumber, travelClass };
    }

    // Guard: only click if visible — avoids 30 s timeout when card not expanded
    const linkVisible = await eticketLink.isVisible({ timeout: 500 }).catch(() => false);
    if (!linkVisible) {
      log('   Reason: "View E-ticket & receipts" not visible — card not expanded, ticket skipped');
      return { ticketNumber, travelClass };
    }

    await eticketLink.click();
    log('   Clicked "View E-ticket & receipts"');
    await delay(150);

    // ── Failsafe: did clicking e-ticket navigate to login page? ──────────
    if (page.url().includes('socialLogin') || page.url().includes('login')) {
      log('   Reason: E-ticket click navigated to login page (URL navigated away) — ticket skipped');
      await closeAnyOpenModal(page, log);
      return { ticketNumber, travelClass };
    }

    // ── Failsafe: if a login-like dialog appeared ────────────────────────
    try {
      const visibleModal = page.locator('[role="dialog"]:visible').last();
      const mText = await visibleModal.innerText({ timeout: 800 }).catch(() => '');
      if (/log\s*in|sign\s*in|email.*password|continue\s+with\s+google|forgot\s+password/i.test(mText)) {
        log('   Reason: Login modal appeared on e-ticket click (wrong modal opened) — ticket skipped');
        for (const fn of [
          // The login modal typically has a × (cross) button in the top right
          () => visibleModal.locator('button:has-text("close")').first().click({ timeout: 400 }),
          () => visibleModal.locator('button[aria-label*="close" i]').first().click({ timeout: 400 }),
          () => visibleModal.locator('button[aria-label*="dismiss" i]').first().click({ timeout: 400 }),
          () => visibleModal.getByRole('button', { name: /close/i }).first().click({ timeout: 400 }),
          () => visibleModal.getByRole('button', { name: /^[×✕✖xX]$/i }).first().click({ timeout: 400 }),
          // Click the first button in the modal (often the X close in top-right)
          () => visibleModal.locator('button').first().click({ timeout: 400 }),
          () => page.keyboard.press('Escape'),
          async () => { await delay(75); await page.keyboard.press('Escape'); },
        ]) {
          try {
            await (fn as () => Promise<void>)();
            await delay(150);
            const stillOpen = await visibleModal.isVisible({ timeout: 300 }).catch(() => false);
            if (!stillOpen) { log('   ✓ Login modal closed'); break; }
          } catch { /* try next */ }
        }
        return { ticketNumber, travelClass };
      }
    } catch { /* not a login modal — continue */ }

    // Step 5: Click "View E-ticket" in the outer modal (NOT "View receipt")
    let viewEticketBtn: Locator | null = null;
    const viewSelectors = [
      () => page.getByRole('link',   { name: /^View E-ticket$/i }).first(),
      () => page.getByRole('button', { name: /^View E-ticket$/i }).first(),
      () => page.getByText('View E-ticket', { exact: true }).first(),
      () => page.getByText(/^View E-ticket$/i).first(),
    ];

    for (const getSel of viewSelectors) {
      try {
        const el = getSel();
        await el.waitFor({ state: 'visible', timeout: 1500 });
        viewEticketBtn = el;
        break;
      } catch { /* try next */ }
    }

    if (!viewEticketBtn) {
      log('   Reason: "View E-ticket" button not found in outer modal — ticket skipped');
      await closeTopModal(page, log);
      return { ticketNumber, travelClass };
    }

    await viewEticketBtn.click();
    log('   Clicked "View E-ticket"');
    await delay(150);

    // ── Detect modal variant ──────────────────────────────────────────────────
    //
    //  Variant B — inner dialog has collapsible accordion rows:
    //    "E-ticket 1", "E-ticket 2", …
    //  Each must be clicked to expand, then ticket number + fare class extracted.
    //
    //  Variant A — inner dialog directly shows the e-ticket content
    //    (single ticket number, single fare class visible without accordion).

    // Give the modal time to settle, then check for accordion items
    await delay(200);
    const accordionItems = await page.getByText(/^E-ticket\s+\d+$/i).all();

    if (accordionItems.length > 0) {
      // ── Variant B: accordion ──────────────────────────────────────────────
      log(`   Variant B: ${accordionItems.length} accordion e-ticket item(s) found`);
      const allTickets: string[] = [];
      const allClasses: string[] = [];

      for (let ai = 0; ai < accordionItems.length; ai++) {
        try {
          // Re-fetch each time because DOM may rerender after expand
          const freshItems = await page.getByText(/^E-ticket\s+\d+$/i).all();
          if (!freshItems[ai]) continue;

          await freshItems[ai].click();
          log(`   Expanded "E-ticket ${ai + 1}"`);
          await delay(200);

          // Read the expanded content from the innermost visible dialog
          const dialogEl = page.locator('[role="dialog"]').last();
          let accordionText = '';
          try {
            accordionText = await dialogEl.innerText({ timeout: 1000 });
          } catch {
            accordionText = await page.locator('body').innerText().catch(() => '');
          }

          // Ticket number: "E-ticket number  065-2196017977"
          const tMatch =
            accordionText.match(/E-ticket\s+number\s+([\d]{3}[-\s]?[\d]{10,13})/i) ??
            accordionText.match(/(065[-\s]?\d{10,13})/);
          if (tMatch) {
            const tn = tMatch[1].replace(/\s+/, '-').trim();
            if (!allTickets.includes(tn)) allTickets.push(tn);
          }

          // Fare class: "Fare class  J"
          const cMatch = accordionText.match(/Fare\s+class\s+([A-Z])\b/i);
          if (cMatch && !allClasses.includes(cMatch[1])) allClasses.push(cMatch[1]);

          log(`   E-ticket ${ai + 1}: ticket=${tMatch?.[1] ?? 'n/a'} | class=${cMatch?.[1] ?? 'n/a'}`);

          // Collapse before opening the next accordion item (re-click to toggle)
          try {
            const freshItems2 = await page.getByText(/^E-ticket\s+\d+$/i).all();
            if (freshItems2[ai]) {
              await freshItems2[ai].click();
              await delay(150);
            }
          } catch { /* ignore if already collapsed */ }

        } catch (err) {
          log(`   ⚠️  E-ticket accordion ${ai + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      ticketNumber = allTickets.join(',');
      travelClass  = allClasses.join(',');
      log(`   All tickets: ${ticketNumber || 'n/a'} | All classes: ${travelClass || 'n/a'}`);

      // Close inner accordion dialog
      await closeTopModal(page, log);
      await delay(75);

      // Close outer "View E-ticket & receipts" modal
      await closeTopModal(page, log);
      await delay(75);

    } else {
      // ── Variant A: content displayed directly in modal ────────────────────
      log('   Variant A: reading e-ticket content directly from modal');

      let modalText = '';
      const modalSelectors = [
        '[role="dialog"]',
        '[class*="eticket" i]',
        '[class*="e-ticket" i]',
        '[class*="modal" i]',
        '[class*="dialog" i]',
      ];

      for (const sel of modalSelectors) {
        try {
          const el  = page.locator(sel).last();
          const txt = await el.innerText({ timeout: 800 });
          if (
            txt.includes('E-ticket number') ||
            txt.includes('Booking reference') ||
            txt.includes('Fare class') ||
            txt.match(/065[-\s]\d{10}/)
          ) {
            modalText = txt;
            break;
          }
        } catch { /* try next */ }
      }

      if (!modalText) {
        log('   ⚠️  Inner modal text empty — reading full page');
        modalText = await page.locator('body').innerText().catch(() => '');
      }

      // E-ticket number: "E-ticket number   065-2196017977"
      const ticketMatch =
        modalText.match(/E-ticket\s+number\s+([\d]{3}[-\s]?[\d]{10,13})/i) ??
        modalText.match(/(065[-\s]?\d{10,13})/);
      if (ticketMatch) {
        ticketNumber = ticketMatch[1].replace(/\s+/, '-').trim();
      }

      // Fare class: "Fare class   J"
      const classMatch = modalText.match(/Fare\s+class\s+([A-Z])\b/i);
      if (classMatch) travelClass = classMatch[1];

      log(`   Ticket: ${ticketNumber || 'n/a'} | Fare class: ${travelClass || 'n/a'}`);

      // ── Verify ticket belongs to this passenger ─────────────────────────
      if (ticketNumber && passengerName) {
        const nameClean = passengerName
          .replace(/^(Mr|Mrs|Ms|Miss|Mstr|Master|Mst|Mx|Dr|Prof|Captain|Capt|Col|Gen|Sir|Lady|Lord|Dame|Inf|Infant|Baby)\.?\s+/i, '')
          .trim().toLowerCase();
        const nameWords = nameClean.split(/\s+/);
        const modalLower = modalText.toLowerCase();
        // Check if at least the last name word appears in the modal text
        const lastWord = nameWords[nameWords.length - 1] || '';
        if (lastWord.length > 2 && !modalLower.includes(lastWord)) {
          log(`   ⚠️  TICKET MISMATCH: "${lastWord}" not found in e-ticket modal — skipping ticket`);
          ticketNumber = '';
          travelClass  = '';
        }
      }

      // Close inner E-ticket modal
      await closeTopModal(page, log);
      await delay(75);

      // Close outer "View E-ticket & receipts" modal
      await closeTopModal(page, log);
      await delay(75);
    }

  } catch (err) {
    log(`   ⚠️  E-ticket extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    // Emergency close
    await closeAnyOpenModal(page, log);
    await delay(100);
    await page.keyboard.press('Escape').catch(() => {});
    await delay(150);
  }

  // Final cleanup: dismiss ANY remaining visible dialogs to prevent blocking next passenger
  try {
    const remaining = await page.locator('[role="dialog"]').all();
    for (const d of remaining) {
      if (await d.isVisible({ timeout: 100 }).catch(() => false)) {
        log('   ⚠️  Stale dialog still open after e-ticket — force closing');
        await page.keyboard.press('Escape');
        await delay(100);
        if (await d.isVisible({ timeout: 100 }).catch(() => false)) {
          await d.locator('button:has-text("close")').first().click({ timeout: 1000 }).catch(() => {});
          await delay(100);
        }
      }
    }
  } catch { /* ignore */ }

  return { ticketNumber, travelClass };
}

// ── Modal closer ──────────────────────────────────────────────────────────────

/**
 * Attempts to close the topmost open modal/drawer using several strategies.
 * Falls back to Escape key if nothing else works.
 */
async function closeTopModal(page: Page, log: LogFn): Promise<void> {
  const strategies: Array<() => Promise<void>> = [
    // Angular Material dialog close button (renders "close" as icon font text)
    () => page.locator('[role="dialog"] button:has-text("close")').last().click({ timeout: 400 }),
    () => page.locator('[role="dialog"] a.close-icon').last().click({ timeout: 400 }),
    () => page.getByRole('button', { name: /^[×x✕✖]$/i }).last().click({ timeout: 400 }),
    () => page.locator('button[aria-label*="close" i]').last().click({ timeout: 400 }),
    () => page.locator('button[aria-label*="dismiss" i]').last().click({ timeout: 400 }),
    () => page.locator('[class*="close-btn" i], [class*="closeBtn" i], [class*="modal-close" i]').last().click({ timeout: 400 }),
    () => page.getByRole('button', { name: /close/i }).last().click({ timeout: 400 }),
    () => page.keyboard.press('Escape'),
  ];

  for (const fn of strategies) {
    try {
      await fn();
      await delay(100);
      // Verify it actually closed
      const stillOpen = await page.locator('[role="dialog"]').last().isVisible({ timeout: 200 }).catch(() => false);
      if (!stillOpen) {
        log('   ✓ Modal closed');
        return;
      }
    } catch { /* try next strategy */ }
  }
  // Last resort: triple Escape
  await page.keyboard.press('Escape');
  await delay(75);
  await page.keyboard.press('Escape');
  await delay(75);
  await page.keyboard.press('Escape');
  log('   ⚠️  Modal close — triple Escape sent');
}

// ── Utility ───────────────────────────────────────────────────────────────────

/** Extracts the last name by stripping the title prefix and taking the final word */
function parseLastName(fullName: string): string {
  // Strip any known title prefix before taking the last word as last name
  const titleStripRe = new RegExp(`^(?:${TITLE_PATTERN})\\.?\\s+`, 'i');
  const stripped = fullName.replace(titleStripRe, '').trim();
  const parts = stripped.split(/\s+/);
  return parts[parts.length - 1] ?? '';
}

/** Returns a text snapshot of the page (for debugging) */
export async function getPageSnapshot(page: Page): Promise<string> {
  return page.locator('body').innerText().catch(() => '');
}
