import { Types } from 'mongoose';
import { CheckoutCanaryCron } from './checkout-canary.cron';

function chain<T>(value: T) {
  const c: any = { exec: jest.fn().mockResolvedValue(value) };
  return c;
}

describe('CheckoutCanaryCron.run', () => {
  const variantModel: any = { findOne: jest.fn() };
  const orderModel: any = { deleteMany: jest.fn() };
  const tenants: any = { findBySlug: jest.fn(), resolveFeatures: jest.fn().mockReturnValue([]) };
  const drafts: any = { createPublic: jest.fn(), patchByToken: jest.fn(), submitByToken: jest.fn() };
  const notify: any = {
    logStaffAlert: jest.fn(),
    sendStaffEmail: jest.fn().mockResolvedValue(undefined),
  };
  const config: any = { get: jest.fn() };

  const cron = new CheckoutCanaryCron(variantModel, orderModel, tenants, drafts, notify, config);

  const tenantId = new Types.ObjectId();
  const variantId = new Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
    tenants.resolveFeatures.mockReturnValue([]);
    config.get.mockImplementation((key: string) => {
      if (key === 'CANARY_TENANT_SLUG') return 'canary';
      if (key === 'CANARY_VARIANT_SKU') return 'CANARY-SKU';
      return undefined;
    });
  });

  it('AC9: no-op sem CANARY_TENANT_SLUG configurado — nenhuma query, nenhum alerta', async () => {
    config.get.mockReturnValue(undefined);

    await cron.run();

    expect(tenants.findBySlug).not.toHaveBeenCalled();
    expect(drafts.createPublic).not.toHaveBeenCalled();
    expect(notify.logStaffAlert).not.toHaveBeenCalled();
  });

  it('avisa (log) e não tenta rodar quando falta só CANARY_VARIANT_SKU', async () => {
    config.get.mockImplementation((key: string) => (key === 'CANARY_TENANT_SLUG' ? 'canary' : undefined));

    await cron.run();

    expect(tenants.findBySlug).not.toHaveBeenCalled();
    expect(notify.logStaffAlert).not.toHaveBeenCalled();
  });

  it('AC7: fluxo completo — cria draft, faz patch e submit, registra canary_ok em sucesso', async () => {
    tenants.findBySlug.mockResolvedValue({ _id: tenantId, active: true, slug: 'canary' });
    variantModel.findOne.mockReturnValue(chain({ _id: variantId, sku: 'CANARY-SKU' }));
    drafts.createPublic.mockResolvedValue({ sessionToken: 'tok-123' });
    drafts.patchByToken.mockResolvedValue({});
    drafts.submitByToken.mockResolvedValue({ orderId: 'order-1' });

    await cron.run();

    expect(drafts.createPublic).toHaveBeenCalledWith(
      String(tenantId),
      expect.objectContaining({ waId: 'loop26-canary' }),
    );
    expect(drafts.patchByToken).toHaveBeenCalledWith(
      String(tenantId),
      'tok-123',
      expect.objectContaining({ lines: [{ variantId: String(variantId), quantity: 1 }] }),
      [],
    );
    expect(drafts.submitByToken).toHaveBeenCalledWith(String(tenantId), 'tok-123', {});
    expect(notify.logStaffAlert).toHaveBeenCalledWith(
      'canary_ok',
      expect.objectContaining({ tenantSlug: 'canary', orderId: 'order-1' }),
    );
    expect(notify.sendStaffEmail).not.toHaveBeenCalled();
  });

  it('AC8: tenant de canário inexistente falha na etapa resolve_tenant e alerta com o motivo', async () => {
    tenants.findBySlug.mockResolvedValue(null);

    await cron.run();

    expect(notify.logStaffAlert).toHaveBeenCalledWith(
      'canary_failed',
      expect.objectContaining({ tenantSlug: 'canary', step: 'resolve_tenant' }),
    );
    expect(notify.sendStaffEmail).toHaveBeenCalledWith(
      expect.stringContaining('resolve_tenant'),
      expect.anything(),
    );
  });

  it('AC8: variante de canário inexistente falha na etapa resolve_variant, não em create_draft/submit', async () => {
    tenants.findBySlug.mockResolvedValue({ _id: tenantId, active: true, slug: 'canary' });
    variantModel.findOne.mockReturnValue(chain(null));

    await cron.run();

    expect(drafts.createPublic).not.toHaveBeenCalled();
    expect(notify.logStaffAlert).toHaveBeenCalledWith(
      'canary_failed',
      expect.objectContaining({ step: 'resolve_variant' }),
    );
  });

  it('AC8: falha no submit (ex.: o próprio bug de atacado que este loop existe pra pegar) reporta step submit_draft', async () => {
    tenants.findBySlug.mockResolvedValue({ _id: tenantId, active: true, slug: 'canary' });
    variantModel.findOne.mockReturnValue(chain({ _id: variantId, sku: 'CANARY-SKU' }));
    drafts.createPublic.mockResolvedValue({ sessionToken: 'tok-123' });
    drafts.patchByToken.mockResolvedValue({});
    drafts.submitByToken.mockRejectedValue(new Error('Preço de atacado exige quantidade mínima de 6'));

    await cron.run();

    expect(notify.logStaffAlert).toHaveBeenCalledWith(
      'canary_failed',
      expect.objectContaining({
        step: 'submit_draft',
        message: expect.stringContaining('quantidade mínima'),
      }),
    );
  });

  it('nunca deixa o cron inteiro cair mesmo se sendStaffEmail também falhar', async () => {
    tenants.findBySlug.mockResolvedValue(null);
    notify.sendStaffEmail.mockRejectedValueOnce(new Error('SMTP down'));

    await expect(cron.run()).resolves.toBeUndefined();
  });
});

describe('CheckoutCanaryCron.prune', () => {
  const variantModel: any = {};
  const orderModel: any = { deleteMany: jest.fn() };
  const tenants: any = { findBySlug: jest.fn() };
  const drafts: any = {};
  const notify: any = { logStaffAlert: jest.fn(), sendStaffEmail: jest.fn() };
  const config: any = { get: jest.fn() };

  const cron = new CheckoutCanaryCron(variantModel, orderModel, tenants, drafts, notify, config);
  const tenantId = new Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('no-op sem CANARY_TENANT_SLUG', async () => {
    config.get.mockReturnValue(undefined);

    await cron.prune();

    expect(tenants.findBySlug).not.toHaveBeenCalled();
    expect(orderModel.deleteMany).not.toHaveBeenCalled();
  });

  it('apaga só pedidos do tenant de canário mais velhos que CANARY_RETENTION_DAYS', async () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'CANARY_TENANT_SLUG') return 'canary';
      if (key === 'CANARY_RETENTION_DAYS') return '3';
      return undefined;
    });
    tenants.findBySlug.mockResolvedValue({ _id: tenantId, slug: 'canary' });
    orderModel.deleteMany.mockReturnValue(chain({ deletedCount: 2 }));

    const before = Date.now();
    await cron.prune();

    const call = orderModel.deleteMany.mock.calls[0][0];
    expect(call.tenantId).toBe(tenantId);
    const cutoff = call.createdAt.$lt as Date;
    const daysApplied = (before - cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysApplied).toBeGreaterThan(2.9);
    expect(daysApplied).toBeLessThan(3.1);
  });
});
