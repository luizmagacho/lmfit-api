import type { ExcelColumnDef } from '../common/excel/excel-spreadsheet.service';
import {
  buildSelfAliases,
  mergeAliasMaps,
  normalizeHeaderKey,
} from '../common/excel/header-normalize';

export const PRODUCT_EXPORT_COLUMNS: ExcelColumnDef[] = [
  { key: '_id', header: '_id' },
  { key: 'name', header: 'Nome' },
  { key: 'slug', header: 'slug' },
  { key: 'description', header: 'Descrição' },
  { key: 'category', header: 'Categoria' },
  { key: 'active', header: 'Ativo (Sim/Não)' },
  { key: 'createdAt', header: 'createdAt' },
  { key: 'updatedAt', header: 'updatedAt' },
];

const PT_MAP = Object.fromEntries(
  [
    ['nome', 'name'],
    ['descricao', 'description'],
    ['descrição', 'description'],
    ['categoria', 'category'],
    ['ativo (sim/nao)', 'active'],
    ['ativo', 'active'],
  ].map(([k, v]) => [normalizeHeaderKey(k), v]),
);

const SELF = [
  '_id',
  'name',
  'slug',
  'description',
  'category',
  'active',
  'createdAt',
  'updatedAt',
];

export function productImportHeaderAliases(): Record<string, string> {
  return mergeAliasMaps(buildSelfAliases(SELF), PT_MAP, {
    [normalizeHeaderKey('ID')]: '_id',
  });
}
