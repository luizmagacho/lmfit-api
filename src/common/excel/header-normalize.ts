/** Lowercase, trim, strip combining marks (for PT-BR header matching). */
export function normalizeHeaderKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Map normalized header → canonical API field name (include PT + self-mapped keys). */
export function buildSelfAliases(apiKeys: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (const k of apiKeys) {
    o[normalizeHeaderKey(k)] = k;
  }
  return o;
}

export function mergeAliasMaps(
  ...maps: Record<string, string>[]
): Record<string, string> {
  return Object.assign({}, ...maps);
}

export function resolveHeaderToApiKey(
  headerCell: string,
  mergedAliases: Record<string, string>,
): string | undefined {
  const n = normalizeHeaderKey(headerCell);
  if (!n) return undefined;
  return mergedAliases[n];
}
