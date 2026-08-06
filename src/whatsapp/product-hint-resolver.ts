export type ResolvedProductHint = {
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  size?: string;
  color?: string;
  priceRetail: number;
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

/** Naive PT-BR singular/plural tolerance, same rule used by the storefront chat AI. */
function matchesToken(haystack: string, token: string): boolean {
  if (haystack.includes(token)) return true;
  if (token.length > 3 && token.endsWith('es')) return haystack.includes(token.slice(0, -2));
  if (token.length > 3 && token.endsWith('s')) return haystack.includes(token.slice(0, -1));
  return false;
}

/**
 * Loop 12-B — turns a free-text product description dictated by a seller ("camisa Real Madrid
 * tamanho G") into a real catalog variant, WITHOUT ever asking an LLM to invent a variantId or a
 * price (an LLM given only names has no reliable way to pick the right one between near-identical
 * products, and a wrong pick here means the wrong item's stock gets deducted). Deliberately
 * refuses to guess whenever the match isn't clean — a missed sale that gets escalated for a human
 * to fix by hand is much cheaper than a real stock deduction against the wrong product.
 */
export function resolveProductHint(
  products: Array<Record<string, unknown>>,
  description: string,
  size?: string,
  color?: string,
): ResolvedProductHint | null {
  const tokens = tokenize(description);
  if (!tokens.length) return null;

  const scored = products
    .map((p) => {
      const haystack = normalize(`${String(p.name ?? '')} ${String(p.category ?? '')} ${String(p.description ?? '')}`);
      const score = tokens.reduce((acc, t) => (matchesToken(haystack, t) ? acc + 1 : acc), 0);
      return { p, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  // Two products score the same — never guess between equally-likely matches (this is exactly
  // how "camisa Real Madrid" once resolved to a Flamengo shirt when the LLM picked instead).
  if (scored.length > 1 && scored[1].score === scored[0].score) return null;

  const product = scored[0].p;
  const variants = Array.isArray(product.variants) ? (product.variants as Array<Record<string, unknown>>) : [];
  let candidates = variants;
  if (size) {
    const wanted = size.trim().toLowerCase();
    candidates = candidates.filter((v) => String(v.size ?? '').trim().toLowerCase() === wanted);
  }
  if (color) {
    const wanted = color.trim().toLowerCase();
    candidates = candidates.filter((v) => String(v.color ?? '').trim().toLowerCase() === wanted);
  }
  // Zero matches (e.g. requested size doesn't exist) or several (ambiguous — size/color needed
  // but not said) both mean "don't guess which variant."
  if (candidates.length !== 1) return null;

  const v = candidates[0];
  return {
    variantId: String(v._id),
    productId: String(product._id),
    productName: String(product.name ?? ''),
    sku: String(v.sku ?? ''),
    size: typeof v.size === 'string' ? v.size : undefined,
    color: typeof v.color === 'string' ? v.color : undefined,
    priceRetail: Number(v.priceRetail ?? v.price ?? 0),
  };
}
