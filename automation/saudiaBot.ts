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
  // Fare / cabin / badge labels seen in the Flight details modal
  'VIP','BAG','KGS','PNR','ETA','ETD','GMT','UTC',
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

/**
 * True when the URL looks like the saudia.com homepage / landing page rather
 * than an already-open Manage-booking form. On the homepage the Booking
 * reference + Last name fields are hidden behind the "Manage" navigation tab.
 */
export function isSaudiaHomepage(url: string): boolean {
  const lower = url.toLowerCase();
  if (!lower.includes('saudia.com')) return false;
  if (isSaudiaTab(url)) return false;          // already on a booking/manage page
  // Root or a top-level locale / marketing path. Saudia uses language-COUNTRY
  // locale segments such as /en-in, /en-sa, /ar-sa as well as bare /en, /home.
  const path = lower
    .replace(/^https?:\/\/[^/]+/, '')   // strip scheme + host
    .replace(/[?#].*$/, '');            // strip query / hash
  return path === '' || path === '/' ||
    /^\/[a-z]{2}(-[a-z]{2})?\/?$/.test(path) ||   // /en, /en-in, /ar-sa
    /^\/(home|index)\/?$/.test(path);
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

// ── Manage-booking form fill (runs BEFORE extraction) ─────────────────────────

/**
 * Returns the first candidate locator that is actually visible, or null.
 * Each candidate is a thunk so we never build locators we don't need.
 */
async function firstVisible(
  candidates: Array<() => Locator>,
  what:       string,
  log:        LogFn
): Promise<Locator | null> {
  for (const make of candidates) {
    try {
      const loc = make();
      if (await loc.isVisible({ timeout: 800 }).catch(() => false)) return loc;
    } catch { /* try next */ }
  }
  log(`   ⚠️  ${what} not found`);
  return null;
}

/**
 * Types text into an Angular Material (<input matInput>) field reliably.
 *
 * fill() sets .value directly and does NOT fire the keyboard events Angular's
 * ControlValueAccessor listens for, so the model stays empty. Instead:
 *   1. click to focus
 *   2. triple-click to select existing content, then clear it
 *   3. pressSequentially() — real per-key events (50ms) that Angular picks up
 *   4. dispatch input + change events to force Angular's change detection
 */
async function typeInto(input: Locator, value: string): Promise<void> {
  await input.click({ timeout: 2000 }).catch(() => {});
  // Select any existing value (triple click) and delete it
  await input.click({ clickCount: 3, timeout: 2000 }).catch(() => {});
  await input.press('Backspace').catch(() => {});
  // Real keystrokes so Angular Material's value accessor updates the model
  await input.pressSequentially(value, { delay: 50 });
  // Belt-and-suspenders: fire input + change so Angular change detection runs
  await input.evaluate((el: HTMLInputElement) => {
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }).catch(() => {});
}

/**
 * Diagnostic: dumps every visible input/button on the page to the log so we can
 * see the real Angular Material selectors when a field can't be found. Safe to
 * call only on a foreground tab (it uses evaluate()).
 */
async function dumpFormControls(page: Page, log: LogFn): Promise<void> {
  try {
    const controls = await page.evaluate(() => {
      const pick = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return {
          tag:    el.tagName.toLowerCase(),
          ph:     el.getAttribute('placeholder')     || '',
          name:   el.getAttribute('name')            || '',
          id:     (el as HTMLElement).id             || '',
          fcn:    el.getAttribute('formcontrolname') || '',
          aria:   el.getAttribute('aria-label')      || '',
          type:   el.getAttribute('type')            || '',
          text:   (el.textContent || '').trim().slice(0, 30),
          vis:    r.width > 0 && r.height > 0,
        };
      };
      return Array.from(document.querySelectorAll('input, button')).map(pick).filter(c => c.vis);
    });
    log(`   🔍 ${controls.length} visible input/button control(s):`);
    controls.forEach((c: any, i: number) =>
      log(`     [${i}] <${c.tag}> type="${c.type}" ph="${c.ph}" name="${c.name}" id="${c.id}" fcn="${c.fcn}" aria="${c.aria}" text="${c.text}"`)
    );
  } catch (err) {
    log(`   🔍 control dump failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * If the tab is sitting on the saudia.com homepage (rather than an already-open
 * Manage-booking form), click the "Manage" navigation tab to reveal the
 * Booking reference + Last name form, then wait for that form to appear.
 *
 * Detection: we treat the page as "needs Manage clicked" when the PNR input is
 * not already visible AND the URL looks like a homepage/landing page. This keeps
 * tabs the user already left on the Manage form untouched.
 *
 * Returns true once the form is ready (or was already ready); false if the
 * Manage tab could not be found/clicked.
 */
async function ensureManageFormOpen(page: Page, log: LogFn): Promise<boolean> {
  // Already on the form? The Booking reference input being visible is the most
  // reliable signal — short-circuit so we never click Manage needlessly.
  const formInput = page.locator('input[formcontrolname="eticketnum"]').first();
  if (await formInput.isVisible({ timeout: 600 }).catch(() => false)) return true;

  // Not on the form. Only intervene if the URL really is the homepage.
  const url = await getPageUrl(page);
  if (!isSaudiaHomepage(url)) return true;   // some other state — leave it to the caller

  log('   🏠 On saudia.com homepage — clicking "Manage" tab to open the form…');

  const manageTab = await firstVisible([
    // Confirmed via inspection: the Manage tab is the second Angular Material tab.
    () => page.locator('#mat-tab-label-0-1').first(),
    // Any Angular-generated Manage tab ID (the "-1" index is the Manage tab).
    () => page.locator("[id^='mat-tab-label'][id$='-1']").first(),
    // Role-based fallback.
    () => page.getByRole('tab', { name: 'Manage' }).first(),
  ], 'Manage navigation tab', log);
  if (!manageTab) {
    await dumpFormControls(page, log);
    return false;
  }

  await manageTab.click({ timeout: 2500 }).catch(() => {});

  // Wait for the Manage form to render (Booking reference input appears).
  try {
    await formInput.waitFor({ state: 'visible', timeout: 8000 });
    log('   ✓ Manage form opened');
    return true;
  } catch {
    log('   ⚠️  Manage form did not appear after clicking "Manage"');
    return false;
  }
}

/**
 * Submits the Saudia "Manage booking" form (Booking reference + Last name) on a
 * tab the user has left Manage-ready: fills both fields and clicks Continue.
 *
 * IMPORTANT: this does NOT wait for the booking page to load. It returns as soon
 * as Continue is clicked, so the caller can fire submits across many tabs in
 * quick succession and let them all load concurrently (Phase 1). Use
 * waitForBookingPage() afterwards to detect when each tab finished loading.
 *
 * The page is already trusted (human-opened session), so typing + clicking
 * Continue is the same navigation Saudia expects from a real user — it does not
 * re-trigger the bot challenge.
 *
 * Returns true if the form was filled and Continue clicked; false if a field or
 * the button could not be found.
 */
export async function submitManageBooking(
  page:     Page,
  pnr:      string,
  lastName: string,
  log:      LogFn
): Promise<boolean> {
  log(`📝 Submitting — PNR: ${pnr || '(blank)'} | Last name: ${lastName || '(blank)'}`);

  try {
    // ── If on the homepage, click "Manage" to reveal the form first ───────────
    if (!await ensureManageFormOpen(page, log)) {
      log('   ⚠️  Could not open the Manage form — aborting submit for this tab');
      return false;
    }

    // ── Ensure "Booking reference" mode (not "Frequent flyer") ────────────────
    try {
      const refRadio = page.getByText(/^Booking reference$/i).first();
      if (await refRadio.isVisible({ timeout: 500 }).catch(() => false)) {
        await refRadio.click({ timeout: 800 }).catch(() => {});
      }
    } catch { /* non-fatal */ }

    // ── Booking reference / PNR input ─────────────────────────────────────────
    // Confirmed via inspector: the Angular Material control is formcontrolname="eticketnum".
    const pnrInput = await firstVisible([
      () => page.locator('input[formcontrolname="eticketnum"]').first(),
      () => page.getByPlaceholder(/booking reference|e-?ticket/i).first(),
      () => page.getByLabel(/booking reference|e-?ticket/i).first(),
      () => page.locator('input[name*="recordLocator" i], input[name*="pnr" i], input[id*="pnr" i], input[id*="recordLocator" i]').first(),
    ], 'Booking reference input', log);
    if (!pnrInput) {
      await dumpFormControls(page, log);   // show real selectors so we can fix the match
      return false;
    }
    await typeInto(pnrInput, pnr);

    // ── Last name input ───────────────────────────────────────────────────────
    const lnInput = await firstVisible([
      () => page.getByPlaceholder(/last name|surname/i).first(),
      () => page.getByLabel(/last name|surname/i).first(),
      () => page.locator('input[name*="lastName" i], input[id*="lastName" i], input[name*="lastname" i]').first(),
      () => page.locator('input[formcontrolname*="lastName" i], input[formcontrolname*="surname" i]').first(),
    ], 'Last name input', log);
    if (!lnInput) {
      await dumpFormControls(page, log);
      return false;
    }
    await typeInto(lnInput, lastName);

    await humanDelay();

    // ── Continue button (click, do NOT wait for load) ─────────────────────────
    const continueBtn = await firstVisible([
      () => page.getByRole('button', { name: /^continue$/i }).first(),
      () => page.getByRole('button', { name: /continue|retrieve|manage booking|search/i }).first(),
      () => page.locator('button:has-text("Continue")').first(),
      () => page.locator('button[type="submit"]').first(),
    ], 'Continue button', log);
    if (!continueBtn) return false;

    await continueBtn.click({ timeout: 2500 });
    return true;
  } catch (err) {
    log(`   ❌ Submit failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Waits (by polling the tab's URL) until it lands on a booking-details page, or
 * the timeout expires. A tab whose flight is cancelled / needs support stays
 * stuck on the Manage form, so it never reaches a booking URL → ok=false, and
 * the caller swaps in a spare PNR.
 *
 * page.url() is updated from CDP frame events, so it reflects navigation even
 * while the tab is in the background (no evaluate() needed).
 */
export async function waitForBookingPage(
  page:      Page,
  log:       LogFn,
  timeoutMs: number = 35_000
): Promise<{ ok: boolean; url: string }> {
  const start = Date.now();
  let url = page.url();
  while (Date.now() - start < timeoutMs) {
    url = page.url();
    if (isSaudiaTab(url)) {
      await delay(1000);   // let booking content render before extraction reads it
      log(`   ✓ Booking page loaded: ${url}`);
      return { ok: true, url };
    }
    await delay(500);
  }
  log(`   ⚠️  Still stuck on form after ${Math.round(timeoutMs / 1000)}s — "${url || '(empty)'}"`);
  return { ok: false, url };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/** Default no-op pause check (always continue) */
const NO_PAUSE: PauseCheckFn = async () => true;

export async function extractTabData(
  page: Page,
  log: LogFn,
  pauseCheck: PauseCheckFn = NO_PAUSE,
  knownUrl?: string,         // URL from HTTP scan — avoids evaluate() before bringToFront
  knownPnr?: string          // PNR typed into the Manage form — reliable fallback
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
    const pnr = await extractPnr(page, log, knownPnr);
    log(`🔑 PNR: ${pnr || '(not found)'}`);

    // ── Flights ───────────────────────────────────────────────────────────────
    const flights = await extractFlights(page, log);
    log(`✈  Legs found: ${flights.length}`);

    // Fallback: for any leg still missing from/to, open that leg's "Flight
    // details" modal and read the airport codes from it (per-leg, independent).
    await fillMissingFromToFromModal(page, flights, log);

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

/** A Saudia PNR / booking reference: 6 chars, at least one letter (rules out times/numbers) */
const PNR_RE = /\b(?=[A-Z0-9]{6}\b)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6}\b/;

/** A booking reference is 6 alphanumeric with at least one letter (e.g. 8UDBSN) */
function looksLikePnr(s: string): boolean {
  return /^[A-Z0-9]{6}$/.test(s) && /[A-Z]/.test(s);
}

async function extractPnr(page: Page, log: LogFn, knownPnr?: string): Promise<string> {
  // Strategy 1: "Booking reference … 8UDBSN" pattern in body text.
  // Whitespace between the label and value is flexible (newlines, colons, spaces),
  // and the value must contain a letter so we never grab a time like "121005".
  try {
    const body = await page.locator('body').innerText({ timeout: 2000 });
    const m = body.match(/Booking\s*reference\s*[:#]?\s*([A-Z0-9]{6})\b/i);
    if (m && looksLikePnr(m[1].toUpperCase())) {
      log('   PNR found in page body (Booking reference label)');
      return m[1].toUpperCase();
    }
    // Also accept a "PNR" label variant.
    const mp = body.match(/\bPNR\s*[:#]?\s*([A-Z0-9]{6})\b/i);
    if (mp && looksLikePnr(mp[1].toUpperCase())) {
      log('   PNR found in page body (PNR label)');
      return mp[1].toUpperCase();
    }
  } catch { /* continue */ }

  // Strategy 2: DOM — read the value near the "Booking reference" label element.
  // Walk a couple of ancestors so we catch the value whether it's a sibling or
  // nested in a neighbouring node.
  try {
    const label = page.getByText(/booking\s*reference/i).first();
    for (const xp of ['xpath=..', 'xpath=../..', 'xpath=../../..']) {
      const text = await label.locator(xp).first().innerText({ timeout: 800 }).catch(() => '');
      const m = text.match(PNR_RE);
      if (m && looksLikePnr(m[0].toUpperCase())) {
        log('   PNR found via Booking reference label DOM');
        return m[0].toUpperCase();
      }
    }
  } catch { /* continue */ }

  // Strategy 3: URL params
  const urlMatch = page.url().match(/[?&/](?:pnr|ref|booking)[=:/]?([A-Z0-9]{6})/i);
  if (urlMatch && looksLikePnr(urlMatch[1].toUpperCase())) {
    log('   PNR found in URL');
    return urlMatch[1].toUpperCase();
  }

  // Strategy 4: fall back to the PNR we typed into the Manage form. The booking
  // that loaded on this tab IS that PNR, so this is reliable when scraping fails.
  if (knownPnr && looksLikePnr(knownPnr.toUpperCase())) {
    log('   PNR not scraped — using the booking reference entered into the form');
    return knownPnr.toUpperCase();
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

// ── From/To fallback via "Flight details" modal ───────────────────────────────

/**
 * Per-leg fallback for when a leg's from/to airport codes aren't visible on the
 * main booking page. For each leg still missing from OR to, this:
 *   1. Finds the leg's "Flight details" trigger (one per leg, in order).
 *   2. Clicks it to open the modal.
 *   3. Reads every airport code in the modal — they render as a bulleted
 *      "HH:MM , XXX" (time, comma, 3-letter code), e.g. "16:15  , LHR".
 *   4. Uses the FIRST code as origin (from) and the LAST as destination (to).
 *   5. Closes the modal via its X button.
 *
 * Runs independently per leg: a leg that already has both from and to is skipped.
 */
async function fillMissingFromToFromModal(
  page:    Page,
  flights: FlightLeg[],
  log:     LogFn
): Promise<void> {
  if (!flights.some(f => !f.from || !f.to)) return;   // nothing missing

  log('   🔎 Some legs missing from/to — running "Flight details" modal fallback');

  for (let i = 0; i < flights.length; i++) {
    const leg = flights[i];
    if (leg.from && leg.to) continue;   // this leg is already complete — skip

    log(`   ↳ Leg ${i + 1} missing from/to (from="${leg.from}" to="${leg.to}") — opening Flight details`);

    try {
      // Make sure nothing from a previous leg is still blocking the page
      await closeAnyOpenModal(page, log);

      // The i-th "Flight details" trigger corresponds to leg i (first = leg 1).
      const triggers = await findFlightDetailsTriggers(page);
      if (triggers.length === 0) {
        log('   ⚠️  No "Flight details" trigger found — cannot run fallback');
        return;
      }
      const trigger = triggers[i] ?? triggers[triggers.length - 1];

      await trigger.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
      await trigger.click({ timeout: 2000 });
      log(`   ▼ Clicked "Flight details" #${i + 1}`);
      await delay(400);

      const codes = await readModalAirportCodes(page, log);
      if (codes.length >= 2) {
        if (!leg.from) leg.from = codes[0];
        if (!leg.to)   leg.to   = codes[codes.length - 1];
        log(`   ✓ Leg ${i + 1} from modal: ${leg.from} → ${leg.to} (codes: ${codes.join(', ')})`);
      } else if (codes.length === 1) {
        if (!leg.from) leg.from = codes[0];
        log(`   ⚠️  Only 1 airport code in modal for leg ${i + 1}: ${codes[0]}`);
      } else {
        log(`   ⚠️  No airport codes found in Flight details modal for leg ${i + 1}`);
      }

      // Close the modal via its X button (top right)
      await closeFlightDetailsModal(page, log);
      await delay(200);
    } catch (err) {
      log(`   ⚠️  Flight details fallback for leg ${i + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
      await closeAnyOpenModal(page, log);
    }
  }
}

/**
 * Finds the clickable "Flight details" triggers (one per leg, in page order).
 * Tries role-based selectors first, then text-based fallbacks.
 */
async function findFlightDetailsTriggers(page: Page): Promise<Locator[]> {
  const strategies: Array<() => Promise<Locator[]>> = [
    () => page.getByRole('button', { name: /flight details/i }).all(),
    () => page.getByRole('link',   { name: /flight details/i }).all(),
    () => page.locator('button:has-text("Flight details"), a:has-text("Flight details")').all(),
    () => page.getByText(/flight details/i).all(),
  ];
  for (const make of strategies) {
    try {
      const els = await make();
      if (els.length > 0) return els;
    } catch { /* try next */ }
  }
  return [];
}

/**
 * Reads all airport codes from the currently open "Flight details" modal.
 *
 * Each stop renders as a bullet "HH:MM , XXX" (time, comma, 3-letter code),
 * e.g. "16:15  , LHR".  For a multi-stop leg the modal lists every segment:
 *   LHR (origin) → RUH (layover in) → RUH (layover out) → BKK (destination).
 * So codes[0] is the origin and the LAST code is the true destination — the
 * intermediate layover codes are simply skipped by the caller.
 *
 * IMPORTANT: the modal is scrollable and only the first segment is painted
 * when it opens (the destination row sits below the fold). Reading too early
 * yields just the origin + first layover, which is why the destination came
 * out as the layover (RUH) instead of the final stop (BKK). So we scroll the
 * modal to the bottom to force every segment to render, then poll until the
 * code count stops growing before returning.
 */
async function readModalAirportCodes(page: Page, log: LogFn): Promise<string[]> {
  const dlg = page.locator('[role="dialog"]:visible').last();
  try { await dlg.waitFor({ state: 'visible', timeout: 3000 }); } catch { /* read body fallback */ }

  // Pull every "..., XXX" code out of the modal text, in document order.
  const collect = async (): Promise<string[]> => {
    let text = '';
    try { text = await dlg.innerText({ timeout: 1500 }); }
    catch { text = await page.locator('body').innerText().catch(() => ''); }

    const codes: string[] = [];
    // Every airport row is "... , XXX" (comma then 3-letter code) — this holds
    // for BOTH departure rows ("21:55 , GIZ", time before code) and arrival
    // rows (", RUH" then "23:50", code before its time). So matching on the
    // comma+code captures every stop INCLUDING layovers. Stray UI labels like
    // "VIP" are dropped by the NOT_AIRPORT blocklist rather than by the regex.
    const re = /,\s*([A-Z]{3})\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (!NOT_AIRPORT.has(m[1])) codes.push(m[1]);
    }
    return codes;
  };

  // Scroll the modal (and any scrollable child) to the bottom to render lazy
  // content, then poll: keep the longest list seen, stop once it's stable.
  let best: string[] = [];
  let stable = 0;
  for (let pass = 0; pass < 8; pass++) {
    try {
      await dlg.evaluate((el: HTMLElement) => {
        // Saudia's modal scrolls inside <mat-dialog-content> (scrollH≈992,
        // clientH≈493) — scroll that first, then any other scrollable child.
        const main = el.querySelector<HTMLElement>('.mat-dialog-content, mat-dialog-content');
        if (main) main.scrollTop = main.scrollHeight;
        el.scrollTop = el.scrollHeight;
        el.querySelectorAll<HTMLElement>('*').forEach(c => {
          if (c.scrollHeight > c.clientHeight + 4) c.scrollTop = c.scrollHeight;
        });
      });
    } catch { /* non-fatal */ }
    await delay(250);

    const codes = await collect();
    if (codes.length > best.length) { best = codes; stable = 0; }
    else { stable++; }
    if (best.length >= 2 && stable >= 2) break;   // count settled — done
  }

  log(`   Modal airport codes (${best.length}): ${best.length ? best.join(', ') : '(none)'}`);
  return best;
}

/**
 * Closes the "Flight details" modal via its X button.
 *
 * On Saudia this X is NOT a <button> — it's
 *   <div class="custom-overlay-close custom-overlay-close--visible">
 *     <span class="material-icons icon-close-outlined close_icon">close</span>
 *   </div>
 * with no aria-label, so the generic button/role-based closers miss it. We
 * target the real class first, then fall back to the shared closer + Escape.
 */
async function closeFlightDetailsModal(page: Page, log: LogFn): Promise<void> {
  const strategies: Array<() => Promise<void>> = [
    () => page.locator('.custom-overlay-close--visible').last().click({ timeout: 500 }),
    () => page.locator('.custom-overlay-close').last().click({ timeout: 500 }),
    () => page.locator('span.close_icon, span.icon-close-outlined').last().click({ timeout: 500 }),
    () => page.keyboard.press('Escape'),
  ];
  for (const fn of strategies) {
    try {
      await fn();
      await delay(150);
      const stillOpen = await page.locator('[role="dialog"]:visible').last()
        .isVisible({ timeout: 300 }).catch(() => false);
      if (!stillOpen) { log('   ✓ Flight details modal closed'); return; }
    } catch { /* try next */ }
  }
  // Last resort: the shared closer (covers other modal variants)
  await closeTopModal(page, log);
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
    // The (?<![A-Za-z]) guard requires a non-letter (start/space/newline) before
    // the title so a title that is merely the TAIL of a longer word does not
    // match — e.g. "Hindabdulazizms Abdulkarim" must not yield "ms Abdulkarim".
    const re1 = new RegExp(
      `(?<![A-Za-z])((?:${TITLE_PATTERN})\\.?\\s+[\\w][\\w\\s\\-']+?)\\s*[·.\\u00B7]\\s*(?:Adult(?:\\s+with\\s+Infant)?|Child|Infant)`,
      'gi'
    );
    let m: RegExpExecArray | null;
    while ((m = re1.exec(body)) !== null) addName(m[1]);

    // Pass 2: names WITHOUT title — "Muhammad Nabhan · Adult"
    // Only match lines that start with a capital letter followed by at least
    // one more word, ending at the · Adult/Child/Infant marker.
    // The tail word token uses * (not +) so a single-letter middle initial counts
    // as a word — "Sultan Abdullah A Alkhawlani · Child" otherwise fails on the lone
    // "A" and the whole untitled child passenger gets dropped from the count.
    const re2 = /^([A-Z][a-zA-Z]+(?:\s+[A-Za-z][a-zA-Z\-']*)+)\s*[·.\u00B7]\s*(?:Adult(?:\s+with\s+Infant)?|Child|Infant)/gmi;
    while ((m = re2.exec(body)) !== null) addName(m[1]);

    // Dedup safety net: drop any name that is the trailing fragment of a longer
    // detected name (the same title-inside-a-word problem surviving via another
    // path). Normalise to lowercase + single spaces before comparing.
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const deduped = names.filter((a) =>
      !names.some((b) => {
        if (a === b) return false;
        const na = norm(a), nb = norm(b);
        return nb.length > na.length && nb.endsWith(na);
      })
    );
    if (deduped.length !== names.length) {
      const removed = names.filter(n => !deduped.includes(n));
      log(`   Name scan: dropped ${removed.length} duplicate fragment(s) → ${removed.map(n => `"${n}"`).join(', ')}`);
    }

    log(`   Name scan: ${deduped.length} found → ${deduped.map(n => `"${n}"`).join(', ')}`);
    return deduped;
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

  // The PNR may be blank if it couldn't be scraped from the page header. The
  // e-ticket modal of ANY passenger also shows the booking reference, and every
  // passenger on this tab shares the same booking — so the first one we read
  // backfills the rest. `effectivePnr` is updated the moment we find it.
  let effectivePnr = pnr;

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

      // Verify the card actually expanded by confirming the e-ticket section is
      // now visible. The ▼ chevron click can silently fail on cards whose header
      // has no inline "· Edit" (passport already complete), leaving passport AND
      // ticket unreadable. ensureCardExpanded recovers by clicking the name /
      // "· Adult" / chevron — any of which toggles the card open.
      await ensureCardExpanded(page, card, name, i, log);

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
      const { ticketNumber, travelClass, bookingRef } = await extractEticket(page, card, i, fullName || name, log);

      // Failsafe: if the page PNR was blank, adopt the one shown in this
      // passenger's e-ticket and backfill any passengers already recorded.
      if (!effectivePnr && bookingRef) {
        effectivePnr = bookingRef;
        log(`   🔑 PNR recovered from e-ticket: ${bookingRef} — applying to all passengers on this booking`);
        for (const r of results) if (!r.pnr) r.pnr = bookingRef;
      }

      const resolvedLastName = lastName || parseLastName(fullName || name);
      const status: PassengerData['status'] = passportNumber ? 'done' : 'no-passport';

      results.push({
        pnr: effectivePnr,
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
  // Bring the card into view first — an off-screen chevron can fail to click.
  await card.scrollIntoViewIfNeeded({ timeout: 800 }).catch(() => {});

  const strategies: Array<() => Promise<void>> = [
    // ── Card-scoped (most reliable — unaffected by other cards' state) ──────
    () => card.locator('button[aria-expanded="false"]').first().click({ timeout: 400 }),
    () => card.locator('button[aria-expanded]').first().click({ timeout: 400 }),
    () => card.locator('button:has-text("expand_more")').first().click({ timeout: 400 }),
    () => card.locator('button:has-text("keyboard_arrow_down")').first().click({ timeout: 400 }),
    () => card.locator('button').last().click({ timeout: 400 }),
    // ── JS-dispatched click (works when an overlay intercepts a real click) ──
    async () => {
      const btn = card.locator('button[aria-expanded], button:has-text("expand_more"), button:has-text("keyboard_arrow_down")').first();
      await btn.evaluate((el: HTMLElement) => el.click());
    },
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

/**
 * Guarantees a passenger's card is expanded so the deeper section ("View
 * E-ticket & receipts", Personal details Edit/Update) is visible. Success is
 * confirmed by the e-ticket link actually appearing — not merely "a click did
 * not throw" — because the ▼ chevron click silently fails on some cards.
 *
 * If still collapsed it toggles the accordion using the targets the user
 * confirmed all reopen the card: the circular ▼ chevron, the passenger NAME, and
 * the "· Adult/Child/Infant" label. Clicking the name twice handles the case
 * where the first click happened to toggle an already-open card shut.
 */
async function ensureCardExpanded(
  page:  Page,
  card:  Locator,
  name:  string,
  index: number,
  log:   LogFn
): Promise<boolean> {
  // Single-open accordion → there is at most one visible e-ticket link on the page.
  const linkVisibleNow = async (): Promise<boolean> => {
    const links = await page.getByText('View E-ticket & receipts').all().catch(() => []);
    for (const l of links) {
      if (await l.isVisible({ timeout: 200 }).catch(() => false)) return true;
    }
    return false;
  };
  // Poll for up to `ms` — the section renders asynchronously after the expand
  // click, so an instant check gives false negatives and triggers needless
  // re-clicks that can toggle an already-open card shut.
  const isExpanded = async (ms: number): Promise<boolean> => {
    const deadline = Date.now() + ms;
    do {
      if (await linkVisibleNow()) return true;
      await delay(150);
    } while (Date.now() < deadline);
    return false;
  };

  // Generous initial wait: covers the render after the preceding clickExpandButton.
  if (await isExpanded(1200)) return true;

  await card.scrollIntoViewIfNeeded({ timeout: 800 }).catch(() => {});

  const clickChevron = async () =>
    card.locator('button[aria-expanded], button:has-text("expand_more"), button:has-text("keyboard_arrow_down")')
        .first().click({ timeout: 800 });
  const clickName = async () => {
    if (!name) throw new Error('no name');
    await page.getByText(name, { exact: false }).first().click({ timeout: 1000 });
  };
  const clickAdult = async () =>
    card.getByText(/\b(Adult|Child|Infant)\b/i).first().click({ timeout: 800 });

  // Order: chevron (precise) → name → "Adult" → name again (toggle recovery).
  const targets: Array<() => Promise<unknown>> = [clickChevron, clickName, clickAdult, clickName];
  for (const target of targets) {
    try { await target(); } catch { continue; }
    if (await isExpanded(500)) {
      log('   ▼ Card expanded — e-ticket section revealed');
      return true;
    }
  }

  log('   ⚠️  Could not reveal e-ticket section after name / Adult / chevron clicks');
  return false;
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

    // Any 2-letter airline code (uppercase) + 6-12 digits, e.g.
    // "SV 78915244", "SV1000470327", "DL 2679237202" (Delta), "AF...", "KL..." etc.
    // Generalised so we never have to maintain an airline allow-list.
    // The 6-12 digit floor avoids matching short flight numbers like "SV 871".
    const m = text.match(/\b([A-Z]{2})\s?(\d{6,12})\b/);
    if (m) {
      const ff = `${m[1]} ${m[2]}`;
      log(`   FF: ${ff}`);
      return ff;
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

    // ── Strategy 0: precise aria-label (confirmed live via debug/probe-final.js) ──
    // The Personal-details Edit button has aria-label "click to edit <Name>".
    // The Alfursan / Frequent-flyer Edit — which opens a Login modal and must NOT
    // be clicked — has aria-label "edit Alfursan details" and class .edit-ffp.
    //
    // NOTE: getByRole({ name: /click to edit/ }) does NOT match here — Playwright
    // computes this button's accessible name from its visible text ("Edit"), not
    // the aria-label, so the role-name match returns 0. The plain CSS attribute
    // selector (no case-insensitive `i` flag, which Playwright rejects) matches
    // exactly the one correct button. :not(.edit-ffp) is belt-and-suspenders.
    try {
      const candidate = card.locator('button[aria-label*="click to edit"]:not(.edit-ffp)').first();
      if (await candidate.isVisible({ timeout: 600 }).catch(() => false)) {
        editBtn = candidate;
        log('   Personal Details Edit found (aria-label "click to edit")');
      }
    } catch { /* fall through to the text-based strategies below */ }

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
        // Exclude the Alfursan/FF Edit (class .edit-ffp) so the scan can never
        // pick the button that opens the Login modal.
        const allEdits = (await card.getByText('Edit', { exact: true }).all());
        outer: for (const btn of allEdits) {
          if (await btn.locator('xpath=ancestor-or-self::button[contains(@class,"edit-ffp")]')
                       .count().catch(() => 0)) continue;
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
        const ctx = await editBtn.locator('xpath=../..').innerText({ timeout: 300 }).catch(() => '');
        log(`   Edit btn context (attempt ${attempt}): "${ctx.slice(0, 100).replace(/\n+/g, ' ')}"`);
      } catch { /* non-fatal */ }

      await page.evaluate(() => {
        document.querySelectorAll('.cdk-overlay-backdrop').forEach(el => el.remove());
      });
      await page.waitForTimeout(100);

      await editBtn.click();
      log(`   Clicked Edit (attempt ${attempt})`);
      await delay(120);

      // Check if the wrong dialog opened
      try {
        const dlgCount = await page.locator('[role="dialog"]').count();
        if (dlgCount > 0) {
          const topText = await page.locator('[role="dialog"]').last()
            .innerText({ timeout: 400 }).catch(() => '');
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
      await delay(200);
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
      const modalText = await modal.innerText({ timeout: 400 }).catch(() => '');
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
      const snippet = await allDialogs[di].innerText({ timeout: 250 }).catch(() => '');
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
): Promise<{ ticketNumber: string; travelClass: string; bookingRef: string }> {
  let ticketNumber = '';
  let travelClass  = '';
  let bookingRef   = '';   // PNR read from the e-ticket modal (shared across passengers)

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

    // Recovery: the link is missing only because the card never expanded (the ▼
    // click can fail on some cards). Re-expand this passenger's card by clicking
    // the name / "· Adult" / chevron, then retry before giving up — this is what
    // was skipping otherwise-good tickets.
    if (!eticketLink) {
      log('   ↻ E-ticket link not visible — re-expanding card and retrying');
      await ensureCardExpanded(page, card, passengerName, passengerIndex, log);
      await delay(200);
      const retryLinks = await page.getByText('View E-ticket & receipts').all();
      for (const link of retryLinks) {
        if (await link.isVisible({ timeout: 500 }).catch(() => false)) {
          eticketLink = link;
          log('   ✓ E-ticket link appeared after re-expanding');
          break;
        }
      }
    }

    if (!eticketLink) {
      log(`   Reason: "View E-ticket & receipts" link not found for passenger ${passengerIndex + 1} — ticket skipped`);
      return { ticketNumber, travelClass, bookingRef };
    }

    // Guard: only click if visible — avoids 30 s timeout when card not expanded
    const linkVisible = await eticketLink.isVisible({ timeout: 500 }).catch(() => false);
    if (!linkVisible) {
      log('   Reason: "View E-ticket & receipts" not visible — card not expanded, ticket skipped');
      return { ticketNumber, travelClass, bookingRef };
    }

    await eticketLink.click();
    log('   Clicked "View E-ticket & receipts"');
    await delay(150);

    // ── Failsafe: did clicking e-ticket navigate to login page? ──────────
    if (page.url().includes('socialLogin') || page.url().includes('login')) {
      log('   Reason: E-ticket click navigated to login page (URL navigated away) — ticket skipped');
      await closeAnyOpenModal(page, log);
      return { ticketNumber, travelClass, bookingRef };
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
        return { ticketNumber, travelClass, bookingRef };
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
      return { ticketNumber, travelClass, bookingRef };
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

          // Booking reference (PNR) — same for every passenger on this booking
          if (!bookingRef) bookingRef = parseBookingRef(accordionText);

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

      // Booking reference (PNR) — same for every passenger on this booking
      if (!bookingRef) bookingRef = parseBookingRef(modalText);

      log(`   Ticket: ${ticketNumber || 'n/a'} | Fare class: ${travelClass || 'n/a'}${bookingRef ? ` | Booking ref: ${bookingRef}` : ''}`);

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

  return { ticketNumber, travelClass, bookingRef };
}

/** Pulls a "Booking reference" value (PNR) out of e-ticket modal/dialog text */
function parseBookingRef(text: string): string {
  const m = text.match(/Booking\s*reference\s*[:#]?\s*([A-Z0-9]{6})\b/i);
  if (m && looksLikePnr(m[1].toUpperCase())) return m[1].toUpperCase();
  return '';
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
