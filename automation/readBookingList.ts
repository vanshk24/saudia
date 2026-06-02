import ExcelJS from 'exceljs';
import path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BookingEntry {
  pnr:      string;   // booking reference, uppercased, whitespace stripped
  lastName: string;   // a surname on the booking, used only to retrieve it
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Turns any ExcelJS cell value (string, number, rich text, formula) into a trimmed string. */
function cellToString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.text === 'string')      return v.text.trim();
    if (typeof v.result !== 'undefined') return String(v.result).trim();
    if (Array.isArray(v.richText))       return v.richText.map((r: any) => r.text ?? '').join('').trim();
  }
  return String(value).trim();
}

/** Reads a worksheet into a plain 2-D array of trimmed strings (1-based rows/cols flattened to 0-based). */
function worksheetToRows(ws: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    // getCell is 1-based; collect up to the last used column
    const colCount = Math.max(row.cellCount, ws.columnCount, 2);
    for (let c = 1; c <= colCount; c++) cells.push(cellToString(row.getCell(c).value));
    rows.push(cells);
  }
  return rows;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Reads the booking-list input file (the PNR + surname list the user selects).
 *
 * Handles the real-world shape, e.g.:
 *     ,**PASSENGER NAME LIST**     ← junk header lines
 *     ,LPC/SV826/4JUN
 *     ,JEDCGK
 *     ,
 *     PNR,NAME                     ← real header row
 *     7BTSUY,KUNSRIYANI            ← data
 *     7BTSUY,TRIYANTO
 *     ...
 *
 * Behaviour:
 *  - Accepts .xlsx (primary) and .csv.
 *  - Skips leading junk rows; finds the header row that contains a "PNR" cell
 *    and a "NAME"/"surname" cell, and maps those columns. Falls back to
 *    col A = PNR, col B = Name if no header is found.
 *  - DEDUPES by PNR: a PNR that repeats (one row per passenger) is kept ONCE,
 *    using the FIRST surname seen, in first-seen order.
 *
 * Returns the full unique-PNR list. The caller decides how many to actually
 * process (it processes the first N, where N = number of open tabs).
 */
export async function readBookingList(filePath: string): Promise<BookingEntry[]> {
  const wb  = new ExcelJS.Workbook();
  const ext = path.extname(filePath).toLowerCase();

  let ws: ExcelJS.Worksheet | undefined;
  if (ext === '.csv') {
    ws = await wb.csv.readFile(filePath);
  } else {
    await wb.xlsx.readFile(filePath);
    ws = wb.worksheets[0];
  }
  if (!ws) return [];

  const rows = worksheetToRows(ws);

  // ── Locate the header row + columns ─────────────────────────────────────────
  let pnrCol  = 0;   // 0-based
  let nameCol = 1;
  let dataStart = 0;

  const isPnrHeader  = (t: string) => /\bpnr\b|booking|reference|e-?ticket/i.test(t);
  const isNameHeader = (t: string) => /last\s*name|surname|\bname\b/i.test(t);

  let headerFound = false;
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const row = rows[r];
    const pnrIdx  = row.findIndex(isPnrHeader);
    const nameIdx = row.findIndex((t, i) => isNameHeader(t) && i !== pnrIdx);
    if (pnrIdx >= 0 && nameIdx >= 0) {
      pnrCol      = pnrIdx;
      nameCol     = nameIdx;
      dataStart   = r + 1;
      headerFound = true;
      break;
    }
  }

  // Fallback: no header found — assume col A = PNR, col B = Name, and skip any
  // leading rows that don't look like "<pnr>,<name>".
  if (!headerFound) {
    const looksLikePnr = (t: string) => /^[A-Z0-9]{5,7}$/i.test(t);
    dataStart = rows.findIndex(row => looksLikePnr((row[0] ?? '').trim()) && (row[1] ?? '').trim().length > 0);
    if (dataStart < 0) dataStart = 0;
  }

  // ── Read + dedupe ───────────────────────────────────────────────────────────
  const seen    = new Set<string>();
  const entries: BookingEntry[] = [];

  for (let r = dataStart; r < rows.length; r++) {
    const row      = rows[r];
    const pnr      = (row[pnrCol]  ?? '').toUpperCase().replace(/\s+/g, '');
    const lastName = (row[nameCol] ?? '').trim();
    if (!pnr) continue;                 // skip rows without a PNR
    if (seen.has(pnr)) continue;        // dedupe — keep first surname only
    seen.add(pnr);
    entries.push({ pnr, lastName });
  }

  return entries;
}
