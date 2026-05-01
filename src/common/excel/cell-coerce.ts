export function parseBooleanLoose(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  if (['sim', 's', 'true', '1', 'yes'].includes(s)) return true;
  if (['nao', 'não', 'n', 'false', '0', 'no'].includes(s)) return false;
  return undefined;
}

/** Accept comma or dot decimal separator. */
export function parseNumberLoose(v: unknown): number | undefined {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (v instanceof Date) return undefined;
  if (typeof v !== 'string') return undefined;
  const s = v.trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function coerceCellValue(v: unknown): unknown {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v !== null && 'text' in v) {
    return String((v as { text?: string }).text ?? '');
  }
  if (typeof v === 'object' && v !== null && 'result' in v) {
    return coerceCellValue((v as { result?: unknown }).result);
  }
  const b = parseBooleanLoose(v);
  if (b !== undefined) return b;
  if (typeof v === 'string') {
    const n = parseNumberLoose(v);
    if (n !== undefined && /^[\d\s,.+-]+$/.test(v.trim())) return n;
  }
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.toISOString();
  return v;
}
