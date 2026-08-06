import { UnauthorizedException } from '@nestjs/common';
import { CustomerJwtStrategy } from './customer-jwt.strategy';

function makeStrategy() {
  const config: any = { get: jest.fn().mockReturnValue('customer-secret-min-32-chars-aaaaaaaa') };
  return new CustomerJwtStrategy(config);
}

describe('CustomerJwtStrategy.validate', () => {
  it('rejects a payload missing sub', () => {
    const strategy = makeStrategy();
    expect(() => strategy.validate({ sub: '', tenantId: 't1' } as any)).toThrow(UnauthorizedException);
  });

  it('rejects a payload missing tenantId', () => {
    const strategy = makeStrategy();
    expect(() => strategy.validate({ sub: 'c1', tenantId: '' } as any)).toThrow(UnauthorizedException);
  });

  it('accepts a well-formed payload and returns it verbatim', () => {
    const strategy = makeStrategy();
    const out = strategy.validate({ sub: 'c1', tenantId: 't1' });
    expect(out).toEqual({ sub: 'c1', tenantId: 't1' });
  });

  it('throws at construction when JWT_CUSTOMER_ACCESS_SECRET is not configured', () => {
    const config: any = { get: jest.fn().mockReturnValue(undefined) };
    expect(() => new CustomerJwtStrategy(config)).toThrow('JWT_CUSTOMER_ACCESS_SECRET is required');
  });
});
