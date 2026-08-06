import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CustomerAuthService } from './customer-auth.service';

function chain<T>(value: T) {
  const c: any = { exec: jest.fn().mockResolvedValue(value) };
  c.select = () => c;
  c.lean = () => c;
  return c;
}

describe('CustomerAuthService', () => {
  const tenantId = new Types.ObjectId().toString();
  const customerId = new Types.ObjectId().toString();

  const customers: any = {
    findOrCreateByEmail: jest.fn(),
    findOne: jest.fn(),
    findByEmail: jest.fn(),
    update: jest.fn(),
  };
  const jwtService: any = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
  const config: any = { get: jest.fn().mockReturnValue(undefined) };
  const notifications: any = { sendEmail: jest.fn().mockResolvedValue(undefined) };
  const tenants: any = { findById: jest.fn().mockResolvedValue({ loyalty: { redeemValuePerPoint: 0.01 } }) };
  const magicLinkModel: any = { create: jest.fn(), findOne: jest.fn(), deleteOne: jest.fn() };
  const refreshModel: any = { create: jest.fn(), findOne: jest.fn(), deleteOne: jest.fn() };

  const service = new CustomerAuthService(
    customers,
    jwtService,
    config,
    notifications,
    tenants,
    magicLinkModel,
    refreshModel,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    customers.findOne.mockResolvedValue({ _id: customerId, name: 'Ana', email: 'ana@x.com' });
  });

  it('requestMagicLink finds-or-creates the customer and stores a hashed, expiring token', async () => {
    customers.findOrCreateByEmail.mockResolvedValue({ _id: customerId, email: 'ana@x.com' });
    magicLinkModel.create.mockResolvedValue({});
    await service.requestMagicLink(tenantId, 'ANA@X.com  ');
    expect(customers.findOrCreateByEmail).toHaveBeenCalledWith(tenantId, 'ana@x.com  '.trim().toLowerCase());
    expect(magicLinkModel.create).toHaveBeenCalledTimes(1);
    const created = magicLinkModel.create.mock.calls[0][0];
    expect(created.tokenHash).toHaveLength(64); // sha256 hex
    expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(notifications.sendEmail).toHaveBeenCalled();
  });

  it('ignores an unrecognized redirectBase and falls back to WEB_ORIGIN', async () => {
    customers.findOrCreateByEmail.mockResolvedValue({ _id: customerId, email: 'ana@x.com' });
    magicLinkModel.create.mockResolvedValue({});
    await service.requestMagicLink(tenantId, 'ana@x.com', 'https://evil-phish.example.com');
    const [, , text] = notifications.sendEmail.mock.calls[0];
    expect(text).not.toContain('evil-phish.example.com');
  });

  it('accepts an allowlisted subdomain redirectBase', async () => {
    customers.findOrCreateByEmail.mockResolvedValue({ _id: customerId, email: 'ana@x.com' });
    magicLinkModel.create.mockResolvedValue({});
    await service.requestMagicLink(tenantId, 'ana@x.com', 'https://kivoni.kivoni.com.br');
    const [, , text] = notifications.sendEmail.mock.calls[0];
    expect(text).toContain('kivoni.kivoni.com.br');
  });

  it('verifyMagicLink rejects an expired token', async () => {
    magicLinkModel.findOne.mockReturnValue(
      chain({ _id: 'ml1', customerId, expiresAt: new Date(Date.now() - 1000) }),
    );
    await expect(service.verifyMagicLink(tenantId, 'raw-token')).rejects.toThrow(UnauthorizedException);
    expect(magicLinkModel.deleteOne).not.toHaveBeenCalled();
  });

  it('verifyMagicLink rejects an unknown token', async () => {
    magicLinkModel.findOne.mockReturnValue(chain(null));
    await expect(service.verifyMagicLink(tenantId, 'raw-token')).rejects.toThrow(UnauthorizedException);
  });

  it('verifyMagicLink consumes the token (single-use) and issues a session on success', async () => {
    magicLinkModel.findOne.mockReturnValue(
      chain({ _id: 'ml1', customerId, expiresAt: new Date(Date.now() + 60_000) }),
    );
    magicLinkModel.deleteOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });
    refreshModel.create.mockResolvedValue({});
    const out = await service.verifyMagicLink(tenantId, 'raw-token');
    expect(magicLinkModel.deleteOne).toHaveBeenCalledWith({ _id: 'ml1' });
    expect(out.accessToken).toBe('signed.jwt.token');
    expect(out.refreshToken).toEqual(expect.any(String));
    expect(out.customer).toEqual({ id: customerId, name: 'Ana', email: 'ana@x.com' });
  });

  it('refresh rotates the token: deletes the old one and issues a new refresh token', async () => {
    refreshModel.findOne.mockReturnValue(
      chain({ _id: 'rt1', customerId, expiresAt: new Date(Date.now() + 60_000) }),
    );
    refreshModel.deleteOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });
    refreshModel.create.mockResolvedValue({});
    const out = await service.refresh(tenantId, 'raw-refresh');
    expect(refreshModel.deleteOne).toHaveBeenCalledWith({ _id: 'rt1' });
    expect(refreshModel.create).toHaveBeenCalledTimes(1);
    expect(out.accessToken).toBe('signed.jwt.token');
  });

  it('refresh rejects an expired refresh token', async () => {
    refreshModel.findOne.mockReturnValue(
      chain({ _id: 'rt1', customerId, expiresAt: new Date(Date.now() - 1000) }),
    );
    await expect(service.refresh(tenantId, 'raw-refresh')).rejects.toThrow(UnauthorizedException);
  });

  it('me() includes redeemValuePerPoint from the tenant loyalty config (Loop 9)', async () => {
    tenants.findById.mockResolvedValue({ loyalty: { redeemValuePerPoint: 0.05 } });
    const out = await service.me(tenantId, customerId);
    expect(out.redeemValuePerPoint).toBe(0.05);
  });

  it('me() falls back to a default redeemValuePerPoint when the tenant has no loyalty config', async () => {
    tenants.findById.mockResolvedValue({});
    const out = await service.me(tenantId, customerId);
    expect(out.redeemValuePerPoint).toBe(0.01);
  });

  describe('requestEmailChange (Loop 18)', () => {
    it('rejects when the new email is the same as the current one', async () => {
      customers.findOne.mockResolvedValue({ _id: customerId, email: 'ana@x.com' });
      await expect(
        service.requestEmailChange(tenantId, customerId, 'ANA@X.com'),
      ).rejects.toThrow(BadRequestException);
      expect(magicLinkModel.create).not.toHaveBeenCalled();
    });

    it('rejects when the new email is already used by a different customer', async () => {
      customers.findOne.mockResolvedValue({ _id: customerId, email: 'ana@x.com' });
      customers.findByEmail.mockResolvedValue({ _id: new Types.ObjectId().toString(), email: 'taken@x.com' });
      await expect(
        service.requestEmailChange(tenantId, customerId, 'taken@x.com'),
      ).rejects.toThrow(BadRequestException);
      expect(magicLinkModel.create).not.toHaveBeenCalled();
    });

    it('stores a token with purpose "email-change" and the normalized pendingEmail, and e-mails the NEW address', async () => {
      customers.findOne.mockResolvedValue({ _id: customerId, email: 'ana@x.com' });
      customers.findByEmail.mockResolvedValue(null);
      magicLinkModel.create.mockResolvedValue({});

      await service.requestEmailChange(tenantId, customerId, '  NEW@Example.com  ');

      const created = magicLinkModel.create.mock.calls[0][0];
      expect(created.purpose).toBe('email-change');
      expect(created.pendingEmail).toBe('new@example.com');
      expect(notifications.sendEmail).toHaveBeenCalledWith(
        'new@example.com',
        expect.any(String),
        expect.any(String),
        expect.any(String),
      );
    });
  });

  describe('verifyMagicLink — email-change branch (Loop 18)', () => {
    it('updates Customer.email to pendingEmail AND issues a normal session (works from any device)', async () => {
      magicLinkModel.findOne.mockReturnValue(
        chain({
          _id: 'ml1',
          customerId,
          expiresAt: new Date(Date.now() + 60_000),
          purpose: 'email-change',
          pendingEmail: 'new@example.com',
        }),
      );
      magicLinkModel.deleteOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });
      refreshModel.create.mockResolvedValue({});
      customers.update.mockResolvedValue({});

      const out = await service.verifyMagicLink(tenantId, 'raw-token');

      expect(customers.update).toHaveBeenCalledWith(tenantId, customerId, { email: 'new@example.com' });
      expect(out.accessToken).toBe('signed.jwt.token');
    });

    it('a plain login token (purpose "login", the default) never calls customers.update', async () => {
      magicLinkModel.findOne.mockReturnValue(
        chain({ _id: 'ml1', customerId, expiresAt: new Date(Date.now() + 60_000), purpose: 'login' }),
      );
      magicLinkModel.deleteOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) });
      refreshModel.create.mockResolvedValue({});

      await service.verifyMagicLink(tenantId, 'raw-token');

      expect(customers.update).not.toHaveBeenCalled();
    });
  });
});
