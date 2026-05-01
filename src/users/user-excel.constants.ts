import type { ExcelColumnDef } from '../common/excel/excel-spreadsheet.service';
import {
  buildSelfAliases,
  mergeAliasMaps,
  normalizeHeaderKey,
} from '../common/excel/header-normalize';

export const USER_EXPORT_COLUMNS: ExcelColumnDef[] = [
  { key: '_id', header: '_id' },
  { key: 'email', header: 'E-mail' },
  { key: 'name', header: 'Nome' },
  { key: 'role', header: 'Perfil' },
  { key: 'password', header: 'Senha (importar apenas novos)' },
  { key: 'createdAt', header: 'createdAt' },
  { key: 'updatedAt', header: 'updatedAt' },
];

const PT_MAP = Object.fromEntries(
  [
    ['e-mail', 'email'],
    ['email', 'email'],
    ['nome', 'name'],
    ['perfil', 'role'],
    ['senha (importar apenas novos)', 'password'],
    ['senha', 'password'],
  ].map(([k, v]) => [normalizeHeaderKey(k), v]),
);

const SELF = ['_id', 'email', 'name', 'role', 'password', 'createdAt', 'updatedAt'];

export function userImportHeaderAliases(): Record<string, string> {
  return mergeAliasMaps(buildSelfAliases(SELF), PT_MAP, {
    [normalizeHeaderKey('ID')]: '_id',
  });
}
