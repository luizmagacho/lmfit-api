import { Types } from 'mongoose';

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Termos com 3+ caracteres usam o índice de texto do Mongo ($text) — mais rápido
 * e sem risco de ReDoS. Termos curtos caem pra regex escapado nos campos indicados
 * ($text exige tokens completos e ignora buscas parciais de 1-2 letras).
 */
export function buildSearchFilter(
  tenantId: string,
  search: string | undefined,
  regexFields: string[],
): Record<string, any> {
  const base: Record<string, any> = { tenantId: new Types.ObjectId(tenantId) };
  const trimmed = search?.trim();
  if (!trimmed) return base;
  const safe = escapeRegex(trimmed);
  return { ...base, $or: regexFields.map((field) => ({ [field]: new RegExp(safe, 'i') })) };
}
