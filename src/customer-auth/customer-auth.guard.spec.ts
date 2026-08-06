import { UnauthorizedException } from '@nestjs/common';
import { CustomerAuthGuard } from './customer-auth.guard';

function makeContext(user: unknown, tenantId: string | undefined) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, tenantId }) }),
  } as any;
}

describe('CustomerAuthGuard — tenant cross-check (mirrors JwtAuthGuard)', () => {
  const parentProto = Object.getPrototypeOf(CustomerAuthGuard.prototype);

  afterEach(() => jest.restoreAllMocks());

  it('rejects a customer token whose tenantId does not match the resolved request tenant', async () => {
    jest.spyOn(parentProto, 'canActivate').mockResolvedValue(true);
    const guard = new CustomerAuthGuard();
    const ctx = makeContext({ sub: 'cust1', tenantId: 'tenantA' }, 'tenantB');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('accepts when the token tenantId matches the resolved request tenant', async () => {
    jest.spyOn(parentProto, 'canActivate').mockResolvedValue(true);
    const guard = new CustomerAuthGuard();
    const ctx = makeContext({ sub: 'cust1', tenantId: 'tenantA' }, 'tenantA');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('short-circuits (never checks tenant) when the underlying strategy already rejected', async () => {
    jest.spyOn(parentProto, 'canActivate').mockResolvedValue(false);
    const guard = new CustomerAuthGuard();
    const ctx = makeContext(undefined, 'tenantA');
    await expect(guard.canActivate(ctx)).resolves.toBe(false);
  });
});
