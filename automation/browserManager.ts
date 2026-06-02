import { chromium } from 'playwright-core';
import type { Page, Browser, BrowserContext } from 'playwright-core';
import * as http from 'http';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CdpTab {
  id:    string;
  url:   string;
  title: string;
  wsUrl: string;
}

// ── State ─────────────────────────────────────────────────────────────────────

let _tabs:    CdpTab[]         = [];
let _browser: Browser         | null = null;
let _context: BrowserContext  | null = null;
let _port:    number          = 9222;   // CDP debug port; set per-connection so multiple app instances can each target their own Chrome

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Plain HTTP GET to Chrome's JSON endpoint. Never hangs. */
function fetchCdpJson(path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Force IPv4 — Node.js resolves 'localhost' to ::1 (IPv6) on Windows,
    // but Chrome only binds its debug port to 127.0.0.1 (IPv4).
    const req = http.get(`http://127.0.0.1:${_port}${path}`, { timeout: 10_000 }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Failed to parse CDP JSON: ${e}`)); }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(
        `Cannot reach Chrome on port ${_port}.\n` +
        `Make sure Chrome was launched with --remote-debugging-port=${_port}.`
      ));
    });
    req.on('error', (err: Error) => {
      reject(new Error(
        `Cannot reach Chrome on port ${_port}: ${err.message}\n` +
        `Launch Chrome with: chrome.exe --remote-debugging-port=${_port}`
      ));
    });
  });
}

/**
 * Tab discovery filter (used to count/select tabs on connect).
 *
 * Matches ANY saudia.com tab — including the homepage "Manage booking" form
 * that the user leaves Manage-ready before automation fills the PNR + last name
 * and clicks Continue. (The extractor in saudiaBot.ts uses a stricter check
 * that only accepts actual booking-detail URLs, which is what the tab becomes
 * AFTER Continue.)
 */
export function isSaudiaTabUrl(url: string): boolean {
  return url.toLowerCase().includes('saudia.com');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * STEP 1 — Connect button (Screen 2).
 *
 * Uses a plain HTTP GET to Chrome's /json/list — instant, no WebSocket,
 * never hangs regardless of how many tabs are open.
 * Stores the tab list for display; the actual Playwright connection is
 * deferred until automation starts.
 */
export async function connectToBrowser(port: number = 9222): Promise<{ total: number; saudia: number }> {
  _port = port;

  // Drop previous Playwright connection without calling .close()
  // (.close() sends Browser.close CDP command which kills Chrome)
  _browser = null;
  _context = null;

  const targets = await fetchCdpJson('/json/list') as Array<{
    id: string; type: string; url: string; title: string; webSocketDebuggerUrl?: string;
  }>;

  const usable = targets.filter(t =>
    t.type === 'page' &&
    t.url &&
    t.url !== 'about:blank' &&
    !t.url.startsWith('chrome://') &&
    !!t.webSocketDebuggerUrl
  );

  _tabs = usable.map(t => ({
    id:    t.id,
    url:   t.url,
    title: t.title,
    wsUrl: t.webSocketDebuggerUrl!,
  }));

  const saudiaCount = _tabs.filter(t => isSaudiaTabUrl(t.url)).length;
  return { total: _tabs.length, saudia: saudiaCount };
}

export interface SaudiaPage {
  page: Page;
  url:  string;   // from HTTP scan — always correct, never empty
}

/**
 * STEP 2 — Called once when automation starts.
 * Returns { page, url } pairs for every Saudia booking tab.
 *
 * url comes from the HTTP scan (_tabs), not from page.url() — so it is
 * always correct even when Playwright's cached URL is empty.
 * Matching uses CDP target IDs (via a temporary CDPSession per page).
 */
export async function getSaudiaPages(): Promise<SaudiaPage[]> {
  if (!_browser) {
    _browser = await chromium.connectOverCDP(`http://127.0.0.1:${_port}`, { timeout: 90_000 });
  }

  const contexts = _browser.contexts();
  if (contexts.length === 0) {
    throw new Error('No browser context found — is Chrome open with tabs loaded?');
  }

  let allPages: Page[] = [];
  for (const ctx of contexts) allPages.push(...ctx.pages());

  if (allPages.length === 0) {
    await new Promise(r => setTimeout(r, 2000));
    allPages = [];
    for (const ctx of _browser.contexts()) allPages.push(...ctx.pages());
  }

  _context = contexts[0];

  // Build a map: targetId → CdpTab (from the HTTP scan)
  const tabById = new Map(_tabs.map(t => [t.id, t]));
  const saudiaTabIds = new Set(_tabs.filter(t => isSaudiaTabUrl(t.url)).map(t => t.id));

  // No HTTP scan data — fall back to URL-based filter with empty-URL skipping
  if (saudiaTabIds.size === 0) {
    return allPages
      .filter(p => isSaudiaTabUrl(p.url()))
      .map(p => ({ page: p, url: p.url() }));
  }

  // Match each Playwright Page to a CdpTab via CDP target ID.
  // Never call page.url() or page.evaluate() here — background tabs can hang.
  const pageTargetId = new Map<Page, string>();
  const result: SaudiaPage[] = [];
  for (const page of allPages) {
    try {
      const cdp  = await page.context().newCDPSession(page);
      const info = await cdp.send('Target.getTargetInfo') as { targetInfo: { targetId: string } };
      await cdp.detach().catch(() => {});
      const targetId = info.targetInfo.targetId;
      if (saudiaTabIds.has(targetId)) {
        const tab = tabById.get(targetId)!;
        pageTargetId.set(page, targetId);
        result.push({ page, url: tab.url });
      }
    } catch {
      // CDPSession failed — last-resort URL check
      const u = page.url();
      if (isSaudiaTabUrl(u)) result.push({ page, url: u });
    }
  }

  // Fetch /json/list FRESH — Chrome returns targets in current visual left-to-right
  // order with unique `id` fields, so this is correct even when all tabs share a URL.
  let liveOrder: string[] = _tabs.map(t => t.id);   // fallback to cached scan order
  try {
    const live = await fetchCdpJson('/json/list') as Array<{ id: string; type: string }>;
    liveOrder = live.filter(t => t.type === 'page').map(t => t.id);
  } catch (e) {
    console.warn(`Could not refresh /json/list for tab order, using cached order: ${e}`);
  }

  console.log('=== /json/list TAB ORDER ===');
  liveOrder.forEach((id, i) => console.log(`json[${i}]: id=${id}`));
  console.log('=== RESULT BEFORE SORT ===');
  result.forEach((p, i) => console.log(`result[${i}]: id=${pageTargetId.get(p.page) ?? 'unknown'} url=${p.url}`));

  // Sort by the index of each page's target ID in the live /json/list order
  // (unique IDs preserve visual order even when URLs are identical).
  result.sort((a, b) => {
    const aIdx = liveOrder.indexOf(pageTargetId.get(a.page) ?? '');
    const bIdx = liveOrder.indexOf(pageTargetId.get(b.page) ?? '');
    return aIdx - bIdx;
  });

  console.log('=== RESULT AFTER SORT ===');
  result.forEach((p, i) => console.log(`sorted[${i}]: id=${pageTargetId.get(p.page) ?? 'unknown'} url=${p.url}`));

  return result;
}

export function getSaudiaTabs(): CdpTab[] {
  return _tabs.filter(t => isSaudiaTabUrl(t.url));
}

export function getAllTabs(): CdpTab[] {
  return _tabs;
}

export function isConnected(): boolean {
  return _tabs.length > 0;
}

/** Drop references only — NEVER call .close() as that kills Chrome via CDP. */
export async function disconnect(): Promise<void> {
  _browser = null;
  _context = null;
  _tabs    = [];
}
