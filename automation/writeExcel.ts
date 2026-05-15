import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import type { PassengerData } from './saudiaBot';

// ── Column layout — 14 cols matching the user's actual template ───────────────
//
//  Row 1  →  Title (merged A1:N1) — preserved from template
//  Row 2  →  Headers              — preserved from template
//  Row 3+ →  Data rows written by automation
//
// Col:  1       2     3          4        5     6    7         8     9    10          11        12      13           14
//       S.No.   PNR   Last Name  First T  From  To   Second T  From  To   Full Name   FF. No.   Class   Ticket No.   PP No.

const DATA_START_ROW = 3;   // first data row (row 1 = title, row 2 = headers)
const TOTAL_COLS     = 14;

// ── ExcelWriter ───────────────────────────────────────────────────────────────

export class ExcelWriter {
  private workbook:   ExcelJS.Workbook;
  private worksheet!: ExcelJS.Worksheet;
  private nextRow:    number = DATA_START_ROW;
  private serial:     number = 1;
  readonly outputPath: string;

  constructor(outputPath: string) {
    this.workbook   = new ExcelJS.Workbook();
    this.outputPath = outputPath;
  }

  /**
   * Copies the template to outputPath, loads it, clears all old data rows
   * (keeps row 2 headers), writes fileCode into row 1, then saves.
   */
  async init(templatePath: string, fileCode: string): Promise<void> {
    // Always copy fresh template so the title / header formatting is preserved
    if (fs.existsSync(templatePath)) {
      fs.copyFileSync(templatePath, this.outputPath);
    }

    await this.workbook.xlsx.readFile(this.outputPath);

    this.worksheet =
      this.workbook.getWorksheet('Sheet1') ??
      this.workbook.getWorksheet(1) ??
      this.workbook.addWorksheet('Sheet1');

    // Clear every row below the header (row 2) so old template data is removed
    const lastRow = this.worksheet.rowCount;
    for (let r = DATA_START_ROW; r <= lastRow; r++) {
      const row = this.worksheet.getRow(r);
      row.eachCell({ includeEmpty: true }, cell => { cell.value = null; });
      row.commit();
    }

    // Write the user's file code into the title row (row 1, cell A1)
    if (fileCode) {
      const titleCell = this.worksheet.getCell('A1');
      titleCell.value = fileCode;
    }

    this.nextRow = DATA_START_ROW;
    this.serial  = 1;

    await this.save();
  }

  /** Writes one passenger row immediately and saves. */
  async writeRow(pax: PassengerData): Promise<void> {
    const f1 = pax.flights[0] ?? null;
    const f2 = pax.flights[1] ?? null;

    // 14 values in column order — null = blank cell (never a string "null")
    const values: (string | number | null)[] = [
      this.serial,                    // 1  S.No.
      pax.pnr          || null,       // 2  PNR
      pax.lastName     || null,       // 3  Last Name
      f1?.date         || null,       // 4  First T
      f1?.from         || null,       // 5  From
      f1?.to           || null,       // 6  To
      f2?.date         || null,       // 7  Second T
      f2?.from         || null,       // 8  From
      f2?.to           || null,       // 9  To
      pax.fullName     || null,       // 10 Full Name
      pax.ffNumber     || null,       // 11 FF. No.
      pax.travelClass  || null,       // 12 Class
      pax.ticketNumber || null,       // 13 Ticket No.
      pax.passportNumber || null,     // 14 PP No.
    ];

    const row = this.worksheet.getRow(this.nextRow);
    values.forEach((val, i) => {
      row.getCell(i + 1).value = val;
    });

    row.commit();
    this.nextRow++;
    this.serial++;
    await this.save();
  }

  async save(): Promise<void> {
    await this.workbook.xlsx.writeFile(this.outputPath);
  }
}

/** Returns: outputFolder/{fileCode}.xlsx */
export function makeOutputPath(outputFolder: string, fileCode: string): string {
  const safe = fileCode.trim().replace(/[\\/:*?"<>|]/g, '_') || 'saudia_output';
  return path.join(outputFolder, `${safe}.xlsx`);
}
