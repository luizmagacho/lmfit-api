import type { ExcelColumnDef } from '../common/excel/excel-spreadsheet.service';
import {
  buildSelfAliases,
  mergeAliasMaps,
  normalizeHeaderKey,
} from '../common/excel/header-normalize';
export const ORDER_EXPORT_COLUMNS: ExcelColumnDef[] = [
  { key: '_id', header: '_id' },
  { key: 'customerId', header: 'customerId' },
  { key: 'channel', header: 'Canal' },
  { key: 'status', header: 'Status' },
  { key: 'reference', header: 'Referência' },
  { key: 'total', header: 'Total' },
  { key: 'notes', header: 'Observações' },
  { key: 'lines', header: 'Linhas (JSON)' },
  { key: 'createdAt', header: 'createdAt' },
  { key: 'updatedAt', header: 'updatedAt' },
];

const PT_MAP = Object.fromEntries(
  [
    ['cliente', 'customerId'],
    ['cliente id', 'customerId'],
    ['canal', 'channel'],
    ['status', 'status'],
    ['referencia', 'reference'],
    ['referência', 'reference'],
    ['total', 'total'],
    ['observacoes', 'notes'],
    ['observações', 'notes'],
    ['linhas (json)', 'lines'],
    ['linhas', 'lines'],
  ].map(([k, v]) => [normalizeHeaderKey(k), v]),
);

const SELF = [
  '_id',
  'customerId',
  'channel',
  'status',
  'reference',
  'total',
  'notes',
  'lines',
  'createdAt',
  'updatedAt',
];

export function orderImportHeaderAliases(): Record<string, string> {
  return mergeAliasMaps(buildSelfAliases(SELF), PT_MAP, {
    [normalizeHeaderKey('ID')]: '_id',
  });
}
