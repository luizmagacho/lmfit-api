/**
 * Moeda BRL no padrão brasileiro: milhar com `.` e centavos com `,`.
 *
 * Entrada numérica “estilo caixa” (só dígitos): interpreta como **centavos acumulados** / 100
 * (ex.: `"9"` → 0,09 · `"95"` → 0,95 · `"959"` → 9,59 · `"9599"` → 95,99).
 */

const FORMATTER = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatBrlCurrency(value: number): string {
  if (!Number.isFinite(value)) return '0,00';
  return FORMATTER.format(value);
}

/**
 * Converte sequência só de dígitos em valor em reais (últimos 2 dígitos = centavos).
 */
export function digitsAsCentsToReais(digits: string): number {
  const d = digits.replace(/\D/g, '');
  if (!d) return 0;
  const cents = parseInt(d, 10);
  if (!Number.isFinite(cents)) return 0;
  return Math.round(cents) / 100;
}

/**
 * Parse de valores monetários vindos do body (JSON).
 * - `number` → retornado como está (se finito).
 * - `string` só dígitos → centavos / 100.
 * - `string` com vírgula → formato BR (milhar `.`, decimal `,`).
 * - `string` só com ponto e sem vírgula → `parseFloat` (decimal com ponto).
 */
export function parseBrlMoneyInput(value: unknown): unknown {
  if (value === null) return null;
  if (value === undefined || value === '') return undefined;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (!s) return undefined;
  if (/^\d+$/.test(s)) {
    return digitsAsCentsToReais(s);
  }
  if (s.includes(',')) {
    const noThousands = s.replace(/\./g, '');
    const normalized = noThousands.replace(',', '.');
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : NaN;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

export function isMonetaryResponseKey(
  key: string,
  parent: Record<string, unknown>,
): boolean {
  const moneyKeys = new Set([
    'unitPrice',
    'productionPrice',
    'price',
    'priceRetail',
    'priceWholesale',
    'compareAtPrice',
    'amount',
    'avgTicket',
    'revenue',
    'totalRetail',
    'salesToday',
  ]);
  if (moneyKeys.has(key)) return true;
  if (key === 'total') {
    if ('customerId' in parent && ('status' in parent || 'lines' in parent)) {
      return true;
    }
    if ('supplierId' in parent && 'lines' in parent) return true;
    if ('orderCount' in parent && 'source' in parent) return true;
  }
  return false;
}

export function formatMonetaryValuesInJson(node: unknown): unknown {
  if (node === null || node === undefined) return node;
  if (typeof node === 'bigint') return node;
  if (node instanceof Date) return node;
  if (typeof node !== 'object') return node;
  if ('toJSON' in node && typeof (node as any).toJSON === 'function') {
    node = (node as any).toJSON();
  }
  if (!node || typeof node !== 'object') return node;
  if ('_bsontype' in node && node._bsontype === 'ObjectID') return String(node);
  if ('_bsontype' in node && node._bsontype === 'ObjectId') return String(node);
  if (Array.isArray(node)) {
    return node.map((item) => formatMonetaryValuesInJson(item));
  }
  const obj = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (
      typeof v === 'number' &&
      Number.isFinite(v) &&
      isMonetaryResponseKey(k, obj)
    ) {
      out[k] = formatBrlCurrency(v);
    } else if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
      out[k] = formatMonetaryValuesInJson(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
