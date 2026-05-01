import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { coerceCellValue } from './cell-coerce';
import { resolveHeaderToApiKey } from './header-normalize';

export type ExcelColumnDef = { key: string; header: string };

@Injectable()
export class ExcelSpreadsheetService {
  async buildXlsxBuffer(
    sheetName: string,
    columns: ExcelColumnDef[],
    rows: Record<string, unknown>[],
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(sheetName.slice(0, 31) || 'Dados');
    ws.columns = columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: 22,
    }));
    for (const r of rows) {
      const line: Record<string, unknown> = {};
      for (const c of columns) {
        const v = r[c.key];
        line[c.key] =
          v !== null && v !== undefined && typeof v === 'object' && !(v instanceof Date)
            ? JSON.stringify(v)
            : v;
      }
      ws.addRow(line);
    }
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  buildCsvBuffer(columns: ExcelColumnDef[], rows: Record<string, unknown>[]): Buffer {
    const esc = (val: unknown): string => {
      if (val === null || val === undefined) return '';
      const s =
        typeof val === 'object' && !(val instanceof Date)
          ? JSON.stringify(val)
          : String(val);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = columns.map((c) => esc(c.header)).join(',');
    const lines = rows.map((r) =>
      columns.map((c) => esc(r[c.key])).join(','),
    );
    return Buffer.from([header, ...lines].join('\n'), 'utf-8');
  }

  /**
   * First worksheet, row 1 = headers (PT aliases or API keys).
   * Row 2+ = data; fully empty rows skipped.
   */
  async parseFirstSheetToRecords(
    buffer: Buffer,
    headerAliases: Record<string, string>,
  ): Promise<Record<string, unknown>[]> {
    const wb = new ExcelJS.Workbook();
    const copy = Buffer.allocUnsafe(buffer.length);
    buffer.copy(copy, 0, 0, buffer.length);
    // exceljs typings are stricter than Node's Buffer subtype from Mongoose/multer
    await wb.xlsx.load(copy as never);
    const ws = wb.worksheets[0];
    if (!ws) return [];

    const colToKey = new Map<number, string>();
    const headerRow = ws.getRow(1);
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = String(cell.text ?? cell.value ?? '').trim();
      if (!text) return;
      const key = resolveHeaderToApiKey(text, headerAliases);
      if (key) colToKey.set(colNumber, key);
    });

    const records: Record<string, unknown>[] = [];
    const lastRow = ws.rowCount;
    for (let r = 2; r <= lastRow; r++) {
      const row = ws.getRow(r);
      const obj: Record<string, unknown> = {};
      let hasValue = false;
      colToKey.forEach((key, col) => {
        const cell = row.getCell(col);
        const raw = cell.value;
        const val = coerceCellValue(raw);
        if (val !== '' && val !== null && val !== undefined) hasValue = true;
        obj[key] = val;
      });
      if (hasValue) records.push(obj);
    }
    return records;
  }
}
