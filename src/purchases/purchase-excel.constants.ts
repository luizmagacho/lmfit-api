import type { ExcelColumnDef } from '../common/excel/excel-spreadsheet.service';
import {
  buildSelfAliases,
  mergeAliasMaps,
  normalizeHeaderKey,
} from '../common/excel/header-normalize';

export const PURCHASE_EXPORT_COLUMNS: ExcelColumnDef[] = [
  { key: '_id', header: '_id' },
  { key: 'supplierId', header: 'supplierId' },
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
    ['fornecedor', 'supplierId'],
    ['fornecedor id', 'supplierId'],
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
  'supplierId',
  'status',
  'reference',
  'total',
  'notes',
  'lines',
  'createdAt',
  'updatedAt',
];

export function purchaseImportHeaderAliases(): Record<string, string> {
  return mergeAliasMaps(buildSelfAliases(SELF), PT_MAP, {
    [normalizeHeaderKey('ID')]: '_id',
  });
}
