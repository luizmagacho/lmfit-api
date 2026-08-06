import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PaymentsService } from './payments.service';

function paymentDoc(overrides: Record<string, unknown> = {}) {
  const doc: any = {
    _id: new Types.ObjectId(),
    tenantId: new Types.ObjectId(),
    orderId: new Types.ObjectId(),
    status: 'pending',
    amount: 300,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return doc;
}

describe('PaymentsService — confirmation idempotency (AC5)', () => {
  const paymentModel: any = { findById: jest.fn() };
  const orders: any = { update: jest.fn().mockResolvedValue(undefined) };
  const config: any = { get: jest.fn() };
  const webhooks: any = { dispatchPaymentEvent: jest.fn().mockResolvedValue(undefined) };
  const tenants: any = { findById: jest.fn() };
  const analytics: any = { trackPurchase: jest.fn().mockResolvedValue(undefined) };

  const service = new PaymentsService(paymentModel, orders, config, webhooks, tenants, analytics);

  beforeEach(() => jest.clearAllMocks());

  it('confirmPixPaymentPaid completes the order when payment is pending', async () => {
    const doc = paymentDoc();
    paymentModel.findById.mockReturnValue({ exec: () => Promise.resolve(doc) });

    await service.confirmPixPaymentPaid(String(doc._id));

    expect(orders.update).toHaveBeenCalledWith(
      doc.tenantId.toString(),
      String(doc.orderId),
      { status: 'completed' },
      undefined,
    );
  });

  it('confirmPixPaymentPaid rejects a second confirmation (payment no longer pending)', async () => {
    const doc = paymentDoc({ status: 'paid' });
    paymentModel.findById.mockReturnValue({ exec: () => Promise.resolve(doc) });

    await expect(service.confirmPixPaymentPaid(String(doc._id))).rejects.toThrow(
      BadRequestException,
    );
    expect(orders.update).not.toHaveBeenCalled();
  });

  it('confirmInfinitePayPaymentPaid records nsu and rejects when already processed', async () => {
    const doc = paymentDoc();
    paymentModel.findById.mockReturnValue({ exec: () => Promise.resolve(doc) });

    await service.confirmInfinitePayPaymentPaid(String(doc._id), 'nsu-1', 'pix');
    expect(doc.transactionNsu).toBe('nsu-1');
    expect(orders.update).toHaveBeenCalledTimes(1);

    // Webhook replay: mesmo payment, agora não-pendente → 400 (controller devolve "Already processed")
    doc.status = 'paid';
    await expect(
      service.confirmInfinitePayPaymentPaid(String(doc._id), 'nsu-1', 'pix'),
    ).rejects.toThrow(/não está pendente/);
    expect(orders.update).toHaveBeenCalledTimes(1);
  });
});

describe('PaymentsService.syncPaymentPaidForOrder — analytics purchase event (Loop 15)', () => {
  const tenantId = new Types.ObjectId().toString();
  const orderId = new Types.ObjectId();
  const paidPayment = { _id: new Types.ObjectId(), amount: 199.9, paidAt: new Date() };

  const paymentModel: any = {
    updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) }),
    findOne: jest.fn(),
  };
  const orders: any = {};
  const config: any = { get: jest.fn() };
  const webhooks: any = { dispatchPaymentEvent: jest.fn().mockResolvedValue(undefined) };
  const tenants: any = { findById: jest.fn() };
  const analytics: any = { trackPurchase: jest.fn().mockResolvedValue(undefined) };

  const service = new PaymentsService(paymentModel, orders, config, webhooks, tenants, analytics);

  beforeEach(() => {
    jest.clearAllMocks();
    paymentModel.findOne.mockReturnValue({
      sort: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue(paidPayment) }) }),
    });
  });

  it('fires trackPurchase with the order id and paid amount once a payment is confirmed', async () => {
    await service.syncPaymentPaidForOrder(tenantId, orderId);

    expect(analytics.trackPurchase).toHaveBeenCalledWith(tenantId, {
      orderId: String(orderId),
      amount: 199.9,
    });
  });

  it('never lets an analytics failure escape (it is caught, not rethrown)', async () => {
    analytics.trackPurchase.mockRejectedValueOnce(new Error('network down'));

    await expect(service.syncPaymentPaidForOrder(tenantId, orderId)).resolves.toBeUndefined();
  });

  it('does not call trackPurchase when there is no newly-paid payment for that order', async () => {
    paymentModel.findOne.mockReturnValue({
      sort: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue(null) }) }),
    });

    await service.syncPaymentPaidForOrder(tenantId, orderId);

    expect(analytics.trackPurchase).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.markExpiredIfDue (AC7)', () => {
  const paymentModel: any = { findById: jest.fn() };
  const orders: any = { update: jest.fn() };
  const config: any = { get: jest.fn() };
  const webhooks: any = { dispatchPaymentEvent: jest.fn().mockResolvedValue(undefined) };
  const tenants: any = { findById: jest.fn() };
  const analytics: any = { trackPurchase: jest.fn().mockResolvedValue(undefined) };

  const service = new PaymentsService(paymentModel, orders, config, webhooks, tenants, analytics);

  beforeEach(() => jest.clearAllMocks());

  it('marks an overdue pending payment as expired and dispatches payment.expired', async () => {
    const doc = paymentDoc({ expiresAt: new Date(Date.now() - 60_000) });
    paymentModel.findById.mockReturnValue({ exec: () => Promise.resolve(doc) });

    await service.markExpiredIfDue(String(doc._id));

    expect(doc.status).toBe('expired');
    expect(doc.save).toHaveBeenCalled();
    expect(webhooks.dispatchPaymentEvent).toHaveBeenCalledWith(
      'payment.expired',
      expect.objectContaining({
        paymentId: String(doc._id),
        orderId: String(doc.orderId),
        tenantId: String(doc.tenantId),
      }),
    );
  });

  it('does nothing when the payment is not yet due', async () => {
    const doc = paymentDoc({ expiresAt: new Date(Date.now() + 60_000) });
    paymentModel.findById.mockReturnValue({ exec: () => Promise.resolve(doc) });

    await service.markExpiredIfDue(String(doc._id));

    expect(doc.status).toBe('pending');
    expect(doc.save).not.toHaveBeenCalled();
    expect(webhooks.dispatchPaymentEvent).not.toHaveBeenCalled();
  });

  it('does nothing when the payment is not pending (e.g., already paid)', async () => {
    const doc = paymentDoc({ status: 'paid', expiresAt: new Date(Date.now() - 60_000) });
    paymentModel.findById.mockReturnValue({ exec: () => Promise.resolve(doc) });

    await service.markExpiredIfDue(String(doc._id));

    expect(doc.status).toBe('paid');
    expect(webhooks.dispatchPaymentEvent).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.createPixPayment — AC2 (real checkout link vs. dev fallback)', () => {
  const tenantId = new Types.ObjectId().toString();
  const orderId = new Types.ObjectId().toString();

  function makeService() {
    const createdDoc: any = { _id: new Types.ObjectId(), save: jest.fn().mockResolvedValue(undefined) };
    const paymentModel: any = {
      create: jest.fn().mockResolvedValue(createdDoc),
      db: { model: jest.fn().mockReturnValue({ findById: () => ({ lean: () => ({ exec: async () => null }) }) }) },
    };
    const orders: any = {
      update: jest.fn(),
      findOne: jest.fn().mockResolvedValue({ lines: [], reference: 'draft:tok123' }),
    };
    const config: any = {
      get: jest.fn((key: string) => (key === 'PIX_EXPIRES_MINUTES' ? '30' : undefined)),
    };
    const webhooks: any = { dispatchPaymentEvent: jest.fn() };
    const tenants: any = { findById: jest.fn() };
    const analytics: any = { trackPurchase: jest.fn().mockResolvedValue(undefined) };
    const service = new PaymentsService(paymentModel, orders, config, webhooks, tenants, analytics);
    return { service, paymentModel, orders, tenants, createdDoc };
  }

  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('falls back to the dev QR placeholder when the tenant has no real PSP credentials', async () => {
    const { service, paymentModel, tenants } = makeService();
    tenants.findById.mockResolvedValue({ infinitePayTag: undefined, infinitePayApiKey: undefined });

    const doc = await service.createPixPayment(tenantId, orderId, 300);

    expect(paymentModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'pix', qrCode: expect.any(String) }),
    );
    expect(doc.checkoutUrl).toBeUndefined();
  });

  it('delegates to the real InfinitePay checkout link when the tenant has real credentials', async () => {
    const { service, paymentModel, tenants, createdDoc } = makeService();
    tenants.findById.mockResolvedValue({ infinitePayTag: '$loja', infinitePayApiKey: 'key-123' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.infinitepay.io/loja/abc' }),
    }) as any;

    await service.createPixPayment(tenantId, orderId, 300);

    // Sem qrCode "de mentira" quando existe PSP real — o comprador escolhe Pix na página deles.
    expect(paymentModel.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ qrCode: expect.anything() }),
    );
    expect(createdDoc.checkoutUrl).toBe('https://checkout.infinitepay.io/loja/abc');
    expect(createdDoc.save).toHaveBeenCalled();
  });

  it('falls back to the dev QR when creds are configured but the real PSP call fails', async () => {
    const { service, createdDoc, tenants } = makeService();
    tenants.findById.mockResolvedValue({ infinitePayTag: '$loja', infinitePayApiKey: 'invalid-key' });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' }) as any;

    await service.createPixPayment(tenantId, orderId, 300);

    expect(createdDoc.qrCode).toBeDefined();
    expect(createdDoc.checkoutUrl).toBeUndefined();
    expect(createdDoc.save).toHaveBeenCalled();
  });

  it('AC11: the real checkout redirect points at /pedido/confirmado, not the retired /pedido/novo', async () => {
    const { service, tenants } = makeService();
    tenants.findById.mockResolvedValue({ infinitePayTag: '$loja', infinitePayApiKey: 'key-123' });
    let capturedBody: any;
    global.fetch = jest.fn().mockImplementation((_url: string, init: any) => {
      capturedBody = JSON.parse(init.body);
      return Promise.resolve({ ok: true, json: async () => ({ url: 'https://x' }) });
    }) as any;

    await service.createPixPayment(tenantId, orderId, 300);

    expect(capturedBody.redirect_url).toContain('/pedido/confirmado');
    expect(capturedBody.redirect_url).not.toContain('/pedido/novo');
  });
});
