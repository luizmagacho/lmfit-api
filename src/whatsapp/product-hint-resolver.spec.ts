import { resolveProductHint } from './product-hint-resolver';

const realMadrid = {
  _id: 'prod-real',
  name: 'Camisa Real Madrid I 2024',
  category: 'Camisas',
  variants: [
    { _id: 'var-real-g', size: 'G', sku: 'FUT-CRM-G', priceRetail: 299.9 },
    { _id: 'var-real-m', size: 'M', sku: 'FUT-CRM-M', priceRetail: 299.9 },
  ],
};

const flamengo = {
  _id: 'prod-fla',
  name: 'Camisa Flamengo I 2024',
  category: 'Camisas',
  variants: [{ _id: 'var-fla-g', size: 'G', sku: 'FUT-CFI-G', priceRetail: 299.9 }],
};

describe('resolveProductHint (Loop 12-B)', () => {
  it('resolves the exact product+size when the description names it unambiguously (regression: Real Madrid must never resolve to Flamengo)', () => {
    const result = resolveProductHint([realMadrid, flamengo], 'camisa Real Madrid', 'G');
    expect(result?.variantId).toBe('var-real-g');
    expect(result?.productName).toBe('Camisa Real Madrid I 2024');
  });

  it('resolves the other product too, given its own description', () => {
    const result = resolveProductHint([realMadrid, flamengo], 'camisa do Flamengo', 'G');
    expect(result?.variantId).toBe('var-fla-g');
  });

  it('refuses to guess when two products score identically', () => {
    const sameNameTwice = { ...flamengo, _id: 'prod-fla-2', name: 'Camisa Flamengo I 2024 alternativa' };
    const result = resolveProductHint([flamengo, sameNameTwice], 'camisa flamengo', 'G');
    expect(result).toBeNull();
  });

  it('refuses to guess the variant when size is ambiguous', () => {
    const result = resolveProductHint([realMadrid, flamengo], 'camisa Real Madrid');
    expect(result).toBeNull();
  });

  it('refuses to guess when the requested size does not exist for that product', () => {
    const result = resolveProductHint([realMadrid, flamengo], 'camisa Real Madrid', 'GG');
    expect(result).toBeNull();
  });

  it('returns null when nothing in the catalog matches at all', () => {
    const result = resolveProductHint([realMadrid, flamengo], 'tênis de corrida', '42');
    expect(result).toBeNull();
  });

  it('returns null for an empty description', () => {
    const result = resolveProductHint([realMadrid], '', 'G');
    expect(result).toBeNull();
  });

  it('resolves without a size when the product only has one variant', () => {
    const singleVariant = {
      _id: 'prod-single',
      name: 'Boné LM FIT',
      category: 'Acessórios',
      variants: [{ _id: 'var-unico', size: 'Único', sku: 'ACC-BONE', priceRetail: 89.9 }],
    };
    const result = resolveProductHint([realMadrid, singleVariant], 'boné');
    expect(result?.variantId).toBe('var-unico');
  });
});
