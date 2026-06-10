import { getSaudiaPages, SaudiaPage } from './browserManager';
import { extractTabData, PauseCheckFn, submitManageBooking, waitForBookingPage } from './saudiaBot';
import { readBookingList, BookingEntry } from './readBookingList';
import { ExcelWriter, makeOutputPath } from './writeExcel';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AutomationConfig {
  excelTemplatePath: string;
  outputFolderPath:  string;
  fileCode:          string;
  bookingListPath?:  string | null;   // PNR + surname input; when set, the two-phase fill flow runs
}

export interface ProgressUpdate {
  current:    number;
  total:      number;
  currentPnr: string;
}

export interface FailedTabEntry {
  tabNum: number;
  pnr:    string;
  reason: string;
}

export interface AutomationSummary {
  totalProcessed:   number;
  successCount:     number;
  noPassportCount:  number;
  failedCount:      number;
  failedPnrs:       string[];
  failedTabEntries: FailedTabEntry[];
  outputPath:       string;
}

type LogFn      = (msg: string) => void;
type ProgressFn = (update: ProgressUpdate) => void;
type DoneFn     = (summary: AutomationSummary) => void;

// ── Control flags ─────────────────────────────────────────────────────────────

let _pauseRequested = false;
let _stopRequested  = false;

export function requestPause():  void { _pauseRequested = true;  }
export function requestResume(): void { _pauseRequested = false; }
export function requestStop():   void { _stopRequested  = true;  }

// ── Helpers ───────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pnrFromUrl(url: string): string {
  const m = url.match(/[?&/](?:pnr|ref|booking)[=:/]?([A-Z0-9]{6})/i);
  return m ? m[1].toUpperCase() : '';
}

async function waitWhilePaused(log: LogFn): Promise<boolean> {
  if (_pauseRequested) log('⏸ Paused — waiting for resume…');
  while (_pauseRequested && !_stopRequested) await delay(500);
  return !_stopRequested;
}

// ── Main loop ─────────────────────────────────────────────────────────────────

export async function runAutomation(
  config:     AutomationConfig,
  log:        LogFn,
  onProgress: ProgressFn,
  onDone:     DoneFn
): Promise<void> {
  _pauseRequested = false;
  _stopRequested  = false;

  // ── Create Excel output file ────────────────────────────────────────────────
  const outputPath = makeOutputPath(config.outputFolderPath, config.fileCode);
  const writer     = new ExcelWriter(outputPath);

  try {
    await writer.init(config.excelTemplatePath, config.fileCode);
    log(`📄 Output file created: ${outputPath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`❌ Failed to create output file: ${msg}`);
    onDone({ totalProcessed: 0, successCount: 0, noPassportCount: 0, failedCount: 0, failedPnrs: [], failedTabEntries: [], outputPath });
    return;
  }

  // ── Connect to browser and get Saudia Page objects ───────────────────────
  log('🔗 Connecting to browser for automation...');
  let saudiaTabs;
  try {
    saudiaTabs = await getSaudiaPages();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`❌ Browser connection failed: ${msg}`);
    onDone({ totalProcessed: 0, successCount: 0, noPassportCount: 0, failedCount: 0, failedPnrs: [], failedTabEntries: [], outputPath });
    return;
  }

  log(`✅ Saudia booking tabs matched: ${saudiaTabs.length}`);

  const total = saudiaTabs.length;

  if (total === 0) {
    log('');
    log('⚠️  No Saudia booking tabs found.');
    log('   Make sure Chrome has Saudia booking tabs open and click "Connect" again.');
    onDone({ totalProcessed: 0, successCount: 0, noPassportCount: 0, failedCount: 0, failedPnrs: [], failedTabEntries: [], outputPath });
    return;
  }

  // ── Optional: read the PNR + surname booking list ───────────────────────────
  let bookingEntries: BookingEntry[] = [];
  if (config.bookingListPath) {
    try {
      bookingEntries = await readBookingList(config.bookingListPath);
      log(`📋 Booking list: ${bookingEntries.length} unique PNR(s) loaded`);
    } catch (err) {
      log(`❌ Failed to read booking list: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const useBookingFlow = bookingEntries.length > 0;

  // tabEntry[i] = the booking currently assigned to tab i (updated on spare swaps)
  const tabEntry: (BookingEntry | null)[] = [];
  // The first `total` PNRs go into the open tabs; the rest are spares.
  let spareIdx = total;

  // ── PHASE 1 — submit a PNR into every tab (no load wait, staggered) ──────────
  // Fire all submits in quick succession so all tabs load CONCURRENTLY.
  if (useBookingFlow) {
    log('');
    log('🚀 Phase 1 — entering PNRs into all tabs (they load in parallel)…');
    for (let i = 0; i < total; i++) {
      if (_stopRequested) { log('🛑 Stopped by user'); break; }
      const resumed = await waitWhilePaused(log);
      if (!resumed) { log('🛑 Stopped by user'); break; }

      const entry = bookingEntries[i] ?? null;
      tabEntry[i] = entry;
      if (!entry) {
        log(`   ⏭  Tab ${i + 1}: no PNR (more tabs than PNRs) — will skip`);
        continue;
      }

      const { page } = saudiaTabs[i];
      try { await page.bringToFront(); await delay(100); } catch { /* non-fatal */ }

      const ok = await submitManageBooking(page, entry.pnr, entry.lastName, log);
      if (!ok) log(`   ⚠️  Tab ${i + 1}: could not submit PNR ${entry.pnr} (form fields not found)`);

      onProgress({ current: 0, total, currentPnr: `Loading ${entry.pnr}…` });
      await delay(200 + Math.random() * 300);   // small human-like stagger
    }
    log('⏳ Phase 2 — waiting for tabs to load, then extracting…');
  }

  // ── PHASE 2 + 3 — settle each tab (swap spares on failure) then extract ──────
  let current         = 0;
  let totalPassengers = 0;
  let successCount    = 0;
  let noPassportCount = 0;
  let failedCount     = 0;
  const failedPnrs:       string[]          = [];
  const failedTabEntries: FailedTabEntry[]  = [];

  for (let i = 0; i < total; i++) {
    if (_stopRequested) { log('🛑 Stopped by user'); break; }

    const resumed = await waitWhilePaused(log);
    if (!resumed) { log('🛑 Stopped by user'); break; }

    const { page: tab } = saudiaTabs[i];
    let   effectiveUrl  = saudiaTabs[i].url;
    let   entry         = tabEntry[i] ?? null;

    log(`\n══════════════════════════════════════════`);
    log(`📑 Tab ${i + 1} / ${total}${entry ? ` — PNR ${entry.pnr}` : ''}`);

    // Bring the tab to the front so the user can see what's happening
    try {
      await tab.bringToFront();
      await delay(100);
    } catch (err) {
      log(`   ⚠️  bringToFront failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // In the booking flow: wait for the page submitted in Phase 1, swapping in a
    // spare PNR if this tab is stuck on the form (cancelled flight / needs support).
    if (useBookingFlow) {
      if (!entry) {
        failedCount++;
        failedTabEntries.push({ tabNum: i + 1, pnr: '', reason: 'No PNR assigned (more tabs than PNRs)' });
        current++;
        onProgress({ current, total, currentPnr: '' });
        continue;
      }

      let settled = await waitForBookingPage(tab, log);

      while (!settled.ok && spareIdx < bookingEntries.length) {
        if (_stopRequested) break;
        const spare = bookingEntries[spareIdx++];
        log(`   🔄 Tab ${i + 1}: PNR ${entry!.pnr} did not load — swapping spare PNR ${spare.pnr}`);
        entry = spare;
        tabEntry[i] = spare;
        try { await tab.bringToFront(); await delay(100); } catch { /* non-fatal */ }
        const ok = await submitManageBooking(tab, spare.pnr, spare.lastName, log);
        if (!ok) continue;
        settled = await waitForBookingPage(tab, log);
      }

      if (!settled.ok) {
        const pnr = entry?.pnr ?? '';
        log(`   ❌ Tab ${i + 1}: no booking loaded (cancelled/support, no spares left)`);
        failedCount++;
        if (pnr) failedPnrs.push(pnr);
        failedTabEntries.push({
          tabNum: i + 1,
          pnr,
          reason: 'Booking did not load (cancelled / needs support) and no spare PNRs left',
        });
        current++;
        onProgress({ current, total, currentPnr: '' });
        continue;
      }

      effectiveUrl = settled.url;
    }

    onProgress({ current, total, currentPnr: entry?.pnr ?? effectiveUrl });

    // Extract all passenger data from this tab
    const pauseCheck: PauseCheckFn = () => waitWhilePaused(log);
    let passengers: Awaited<ReturnType<typeof extractTabData>>;
    let tabFailReason = '';
    try {
      passengers = await extractTabData(tab, log, pauseCheck, effectiveUrl, entry?.pnr);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`❌ Tab extraction crashed: ${msg}`);
      tabFailReason = `Tab crashed — ${msg.slice(0, 120)}`;
      passengers = [];
    }

    if (passengers.length === 0) {
      const reason = tabFailReason || 'No passengers extracted from page';
      log(`⚠️  No passengers extracted from this tab`);
      failedCount++;
      failedPnrs.push(entry?.pnr ?? effectiveUrl);
      failedTabEntries.push({ tabNum: i + 1, pnr: entry?.pnr ?? pnrFromUrl(effectiveUrl), reason });
    } else {
      // Write each passenger to Excel immediately
      for (const pax of passengers) {
        try {
          await writer.writeRow(pax);
          totalPassengers++;

          if (pax.status === 'done')        successCount++;
          else if (pax.status === 'no-passport') noPassportCount++;
          else                               failedCount++;

          const ppDisplay = pax.passportNumber
            ? `PP: ***${pax.passportNumber.slice(-3)}`
            : 'No passport';
          log(`   ✅ Wrote: ${pax.fullName} | PNR: ${pax.pnr} | ${ppDisplay}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log(`   ❌ Excel write failed for ${pax.fullName}: ${msg}`);
        }
      }
    }

    current++;
    onProgress({ current, total, currentPnr: '' });
    await delay(100); // brief pause before next tab
  }

  // ── Failed tabs summary ─────────────────────────────────────────────────────
  if (failedTabEntries.length > 0) {
    log('');
    log('══════════════════════════════');
    log('FAILED TABS SUMMARY');
    for (const e of failedTabEntries) {
      const pnrPart = e.pnr ? `PNR: ${e.pnr}` : 'PNR: (unknown)';
      log(`Tab ${e.tabNum} — ${pnrPart} — Reason: ${e.reason}`);
    }
    log('══════════════════════════════');
  }

  // ── Final summary ───────────────────────────────────────────────────────────
  log(`\n══════════════════════════════════════════`);
  log(`✅ Done | Passengers written: ${totalPassengers} | No passport: ${noPassportCount} | Failed: ${failedCount}`);
  log(`📁 Saved to: ${outputPath}`);

  onDone({
    totalProcessed: totalPassengers,
    successCount,
    noPassportCount,
    failedCount,
    failedPnrs,
    failedTabEntries,
    outputPath,
  });
}
