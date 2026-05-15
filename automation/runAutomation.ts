import { getSaudiaPages, SaudiaPage } from './browserManager';
import { extractTabData, PauseCheckFn } from './saudiaBot';
import { ExcelWriter, makeOutputPath } from './writeExcel';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AutomationConfig {
  excelTemplatePath: string;
  outputFolderPath:  string;
  fileCode:          string;
}

export interface ProgressUpdate {
  current:    number;
  total:      number;
  currentPnr: string;
}

export interface AutomationSummary {
  totalProcessed: number;
  successCount:   number;
  noPassportCount:number;
  failedCount:    number;
  failedPnrs:     string[];
  outputPath:     string;
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
    onDone({ totalProcessed: 0, successCount: 0, noPassportCount: 0, failedCount: 0, failedPnrs: [], outputPath });
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
    onDone({ totalProcessed: 0, successCount: 0, noPassportCount: 0, failedCount: 0, failedPnrs: [], outputPath });
    return;
  }

  log(`✅ Saudia booking tabs matched: ${saudiaTabs.length}`);

  const total = saudiaTabs.length;

  if (total === 0) {
    log('');
    log('⚠️  No Saudia booking tabs found.');
    log('   Make sure Chrome has Saudia booking tabs open and click "Connect" again.');
    onDone({ totalProcessed: 0, successCount: 0, noPassportCount: 0, failedCount: 0, failedPnrs: [], outputPath });
    return;
  }

  // ── Process each Saudia tab ─────────────────────────────────────────────────
  let current         = 0;
  let totalPassengers = 0;
  let successCount    = 0;
  let noPassportCount = 0;
  let failedCount     = 0;
  const failedPnrs:   string[] = [];

  for (const { page: tab, url: tabUrl } of saudiaTabs) {
    if (_stopRequested) { log('🛑 Stopped by user'); break; }

    const resumed = await waitWhilePaused(log);
    if (!resumed) { log('🛑 Stopped by user'); break; }

    onProgress({ current, total, currentPnr: tabUrl });

    log(`\n══════════════════════════════════════════`);
    log(`📑 Tab ${current + 1} / ${total}: ${tabUrl}`);

    // Bring the tab to the front so the user can see what's happening
    try {
      await tab.bringToFront();
      await delay(100);
    } catch (err) {
      log(`   ⚠️  bringToFront failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Extract all passenger data from this tab
    const pauseCheck: PauseCheckFn = () => waitWhilePaused(log);
    let passengers: Awaited<ReturnType<typeof extractTabData>>;
    try {
      passengers = await extractTabData(tab, log, pauseCheck, tabUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`❌ Tab extraction crashed: ${msg}`);
      passengers = [];
    }

    if (passengers.length === 0) {
      log('⚠️  No passengers extracted from this tab');
      failedCount++;
      failedPnrs.push(tabUrl);
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
    outputPath,
  });
}
