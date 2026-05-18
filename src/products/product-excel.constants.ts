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
  { key: 'sku', header: 'SKU' },
  { key: 'color', header: 'Cor' },
  { key: 'size', header: 'Tamanho' },
  { key: 'price', header: 'Preço' },
  { key: 'quantityInStock', header: 'Estoque' },
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
    ['sku', 'sku'],
    ['cor', 'color'],
    ['tamanho', 'size'],
    ['preco', 'price'],
    ['preço', 'price'],
    ['estoque', 'quantityInStock'],
    ['quantidade', 'quantityInStock'],
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
  'sku',
  'color',
  'size',
  'price',
  'quantityInStock',
  'active',
  'createdAt',
  'updatedAt',
];

export function productImportHeaderAliases(): Record<string, string> {
  return mergeAliasMaps(buildSelfAliases(SELF), PT_MAP, {
    [normalizeHeaderKey('ID')]: '_id',
  });
}
