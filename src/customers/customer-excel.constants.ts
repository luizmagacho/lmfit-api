import type { ExcelColumnDef } from '../common/excel/excel-spreadsheet.service';
import {
  buildSelfAliases,
  mergeAliasMaps,
  normalizeHeaderKey,
} from '../common/excel/header-normalize';

export const CUSTOMER_EXPORT_COLUMNS: ExcelColumnDef[] = [
  { key: '_id', header: '_id' },
  { key: 'name', header: 'Nome' },
  { key: 'email', header: 'E-mail' },
  { key: 'phone', header: 'Telefone' },
  { key: 'taxId', header: 'CPF/CNPJ' },
  { key: 'legalName', header: 'Razão social' },
  { key: 'cpf', header: 'CPF' },
  { key: 'whatsappWaId', header: 'WhatsApp (waId)' },
  { key: 'marketingOptIn', header: 'Marketing (Sim/Não)' },
  { key: 'notes', header: 'Observações' },
  { key: 'addresses', header: 'Endereços (JSON)' },
  { key: 'createdAt', header: 'createdAt' },
  { key: 'updatedAt', header: 'updatedAt' },
];

const PT_ALIASES_ENTRIES: [string, string][] = [
  ['nome', 'name'],
  ['e-mail', 'email'],
  ['email', 'email'],
  ['telefone', 'phone'],
  ['cpf/cnpj', 'taxId'],
  ['documento', 'taxId'],
  ['razao social', 'legalName'],
  ['cpf', 'cpf'],
  ['whatsapp (waid)', 'whatsappWaId'],
  ['whatsapp', 'whatsappWaId'],
  ['marketing (sim/nao)', 'marketingOptIn'],
  ['marketing', 'marketingOptIn'],
  ['observacoes', 'notes'],
  ['observações', 'notes'],
  ['enderecos (json)', 'addresses'],
  ['endereços (json)', 'addresses'],
  ['enderecos', 'addresses'],
];

const PT_ALIASES: Record<string, string> = Object.fromEntries(
  PT_ALIASES_ENTRIES.map(([k, v]) => [normalizeHeaderKey(k), v]),
);

const SELF_KEYS = [
  '_id',
  'name',
  'email',
  'phone',
  'taxId',
  'legalName',
  'cpf',
  'whatsappWaId',
  'marketingOptIn',
  'notes',
  'addresses',
  'createdAt',
  'updatedAt',
];

export function customerImportHeaderAliases(): Record<string, string> {
  return mergeAliasMaps(buildSelfAliases(SELF_KEYS), PT_ALIASES, {
    [normalizeHeaderKey('ID')]: '_id',
    [normalizeHeaderKey('id')]: '_id',
  });
}
