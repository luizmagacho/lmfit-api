import type { ExcelColumnDef } from '../common/excel/excel-spreadsheet.service';
import {
  buildSelfAliases,
  mergeAliasMaps,
  normalizeHeaderKey,
} from '../common/excel/header-normalize';

export const SUPPLIER_EXPORT_COLUMNS: ExcelColumnDef[] = [
  { key: '_id', header: '_id' },
  { key: 'name', header: 'Nome' },
  { key: 'city', header: 'Cidade' },
  { key: 'state', header: 'UF' },
  { key: 'websiteUrl', header: 'Site' },
  { key: 'phone', header: 'Telefone' },
  { key: 'taxId', header: 'CPF/CNPJ' },
  { key: 'notes', header: 'Observações' },
  { key: 'createdAt', header: 'createdAt' },
  { key: 'updatedAt', header: 'updatedAt' },
];

const PT_MAP = Object.fromEntries(
  [
    ['nome', 'name'],
    ['cidade', 'city'],
    ['uf', 'state'],
    ['estado', 'state'],
    ['site', 'websiteUrl'],
    ['telefone', 'phone'],
    ['cpf/cnpj', 'taxId'],
    ['observacoes', 'notes'],
    ['observações', 'notes'],
  ].map(([k, v]) => [normalizeHeaderKey(k), v]),
);

const SELF = [
  '_id',
  'name',
  'city',
  'state',
  'websiteUrl',
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
