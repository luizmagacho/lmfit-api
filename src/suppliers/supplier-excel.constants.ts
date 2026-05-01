import type { ExcelColumnDef } from '../common/excel/excel-spreadsheet.service';
import {
  buildSelfAliases,
  mergeAliasMaps,
  normalizeHeaderKey,
} from '../common/excel/header-normalize';

export const SUPPLIER_EXPORT_COLUMNS: ExcelColumnDef[] = [
  { key: '_id', header: '_id' },
  { key: 'name', header: 'Nome' },
  { key: 'email', header: 'E-mail' },
  { key: 'phone', header: 'Telefone' },
  { key: 'taxId', header: 'CPF/CNPJ' },
  { key: 'notes', header: 'Observações' },
  { key: 'createdAt', header: 'createdAt' },
  { key: 'updatedAt', header: 'updatedAt' },
];

const PT_MAP = Object.fromEntries(
  [
    ['nome', 'name'],
    ['e-mail', 'email'],
    ['email', 'email'],
    ['telefone', 'phone'],
    ['cpf/cnpj', 'taxId'],
    ['observacoes', 'notes'],
    ['observações', 'notes'],
  ].map(([k, v]) => [normalizeHeaderKey(k), v]),
);

const SELF = [
  '_id',
  'name',
  'email',
  'phone',
  'taxId',
  'notes',
  'createdAt',
  'updatedAt',
];

export function supplierImportHeaderAliases(): Record<string, string> {
  return mergeAliasMaps(buildSelfAliases(SELF), PT_MAP, {
    [normalizeHeaderKey('ID')]: '_id',
  });
}
