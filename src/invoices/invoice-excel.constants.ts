import type { ExcelColumnDef } from '../common/excel/excel-spreadsheet.service';
import {
  buildSelfAliases,
  mergeAliasMaps,
  normalizeHeaderKey,
} from '../common/excel/header-normalize';

export const INVOICE_EXPORT_COLUMNS: ExcelColumnDef[] = [
  { key: '_id', header: '_id' },
  { key: 'number', header: 'Número NF' },
  { key: 'status', header: 'Status' },
  { key: 'amount', header: 'Valor' },
  { key: 'dueDate', header: 'Vencimento' },
  { key: 'orderId', header: 'orderId' },
  { key: 'purchaseId', header: 'purchaseId' },
  { key: 'notes', header: 'Observações' },
  { key: 'createdAt', header: 'createdAt' },
  { key: 'updatedAt', header: 'updatedAt' },
];

const PT: [string, string][] = [
  ['numero nf', 'number'],
  ['numero', 'number'],
  ['status', 'status'],
  ['valor', 'amount'],
  ['vencimento', 'dueDate'],
  ['observacoes', 'notes'],
  ['observações', 'notes'],
];

const PT_MAP = Object.fromEntries(PT.map(([k, v]) => [normalizeHeaderKey(k), v]));

const SELF = [
  '_id',
  'number',
  'status',
  'amount',
  'dueDate',
  'orderId',
  'purchaseId',
  'notes',
  'createdAt',
  'updatedAt',
];

export function invoiceImportHeaderAliases(): Record<string, string> {
  return mergeAliasMaps(buildSelfAliases(SELF), PT_MAP, {
    [normalizeHeaderKey('ID')]: '_id',
  });
}
