import type { ExcelColumnDef } from '../common/excel/excel-spreadsheet.service';
import {
  buildSelfAliases,
  mergeAliasMaps,
  normalizeHeaderKey,
} from '../common/excel/header-normalize';

export const ORDER_DRAFT_EXPORT_COLUMNS: ExcelColumnDef[] = [
  { key: '_id', header: '_id' },
  { key: 'sessionToken', header: 'sessionToken' },
  { key: 'customerId', header: 'customerId' },
  { key: 'waId', header: 'waId' },
  { key: 'status', header: 'Status' },
  { key: 'paymentMethodChoice', header: 'Pagamento' },
  { key: 'lines', header: 'Linhas (JSON)' },
  { key: 'orderId', header: 'orderId' },
  { key: 'createdAt', header: 'createdAt' },
  { key: 'updatedAt', header: 'updatedAt' },
];

const PT_MAP = Object.fromEntries(
  [
    ['token', 'sessionToken'],
    ['sessao', 'sessionToken'],
    ['sessão', 'sessionToken'],
    ['cliente', 'customerId'],
    ['status', 'status'],
    ['pagamento', 'paymentMethodChoice'],
    ['linhas (json)', 'lines'],
    ['linhas', 'lines'],
  ].map(([k, v]) => [normalizeHeaderKey(k), v]),
);

const SELF = [
  '_id',
  'sessionToken',
  'customerId',
  'waId',
  'status',
  'paymentMethodChoice',
  'lines',
  'orderId',
  'createdAt',
  'updatedAt',
];

export function orderDraftImportHeaderAliases(): Record<string, string> {
  return mergeAliasMaps(buildSelfAliases(SELF), PT_MAP);
}
