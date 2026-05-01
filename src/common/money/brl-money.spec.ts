import { digitsAsCentsToReais, formatBrlCurrency, parseBrlMoneyInput } from './brl-money';

describe('BRL money', () => {
  it('digits as cents (estilo caixa)', () => {
    expect(digitsAsCentsToReais('9')).toBe(0.09);
    expect(digitsAsCentsToReais('95')).toBe(0.95);
    expect(digitsAsCentsToReais('959')).toBe(9.59);
    expect(digitsAsCentsToReais('9599')).toBe(95.99);
  });

  it('parseBrlMoneyInput accepts pt-BR string', () => {
    expect(parseBrlMoneyInput('1.234,56')).toBe(1234.56);
    expect(parseBrlMoneyInput('0,09')).toBe(0.09);
  });

  it('formatBrlCurrency uses milhar e vírgula', () => {
    expect(formatBrlCurrency(1234.5)).toBe('1.234,50');
    expect(formatBrlCurrency(0.09)).toBe('0,09');
  });
});
