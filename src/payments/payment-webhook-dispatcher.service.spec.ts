import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PaymentWebhookDispatcherService } from './payment-webhook-dispatcher.service';

function chain<T>(value: T) {
  const c: any = { exec: jest.fn().mockResolvedValue(value) };
  c.lean = () => c;
  c.sort = () => c;
  return c;
}

describe('PaymentWebhookDispatcherService.dispatchPaymentEvent — return value (Loop 10)', () => {
  const tenantId = new Types.ObjectId().toString();
  const originalFetch = global.fetch;
  const config: any = {
    get: jest.fn((key: string) => (key === 'WEBHOOK_URL' ? 'https://merchant.example.com/hook' : undefined)),
  };
  const failedWebhookModel: any = { create: jest.fn().mockResolvedValue({}) };
  const service = new PaymentWebhookDispatcherService(config, failedWebhookModel);

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('returns true and persists nothing when the first attempt succeeds', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any;
    const delivered = await service.dispatchPaymentEvent('payment.paid', {
      paymentId: 'p1',
      orderId: 'o1',
      status: 'paid',
      amount: 100,
      tenantId,
    });
    expect(delivered).toBe(true);
    expect(failedWebhookModel.create).not.toHaveBeenCalled();
  });

  it('returns true (no-op) when WEBHOOK_URL is not configured', async () => {
    const noUrlConfig: any = { get: jest.fn().mockReturnValue(undefined) };
    const svc = new PaymentWebhookDispatcherService(noUrlConfig, failedWebhookModel);
    global.fetch = jest.fn();
    const delivered = await svc.dispatchPaymentEvent('payment.paid', {
      paymentId: 'p1',
      orderId: 'o1',
      status: 'paid',
      amount: 100,
    });
    expect(delivered).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it(
    'returns false and persists a FailedWebhook after exhausting all retries',
    async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as any;
      const delivered = await service.dispatchPaymentEvent('payment.paid', {
        paymentId: 'p1',
        orderId: 'o1',
        status: 'paid',
        amount: 100,
        tenantId,
      });
      expect(delivered).toBe(false);
      expect(failedWebhookModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'payment.paid', attempts: 4 }),
      );
    },
    15_000,
  );
});

describe('PaymentWebhookDispatcherService.replayFailedWebhook (Loop 10 DLQ replay)', () => {
  const tenantId = new Types.ObjectId().toString();
  const failedWebhookId = new Types.ObjectId().toString();
  const config: any = { get: jest.fn().mockReturnValue(undefined) };
  const failedWebhookModel: any = { findOne: jest.fn(), create: jest.fn() };
  const service = new PaymentWebhookDispatcherService(config, failedWebhookModel);

  beforeEach(() => jest.clearAllMocks());

  function failedDoc(overrides: Record<string, unknown> = {}) {
    return {
      _id: failedWebhookId,
      tenantId,
      event: 'payment.paid',
      payload: { event: 'payment.paid', paymentId: 'p1', orderId: 'o1', status: 'paid', amount: 100, tenantId },
      resolved: false,
      save: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it('throws NotFoundException for a non-ObjectId id', async () => {
    await expect(service.replayFailedWebhook(tenantId, 'not-an-id')).rejects.toThrow(NotFoundException);
    expect(failedWebhookModel.findOne).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when no matching document exists for this tenant', async () => {
    failedWebhookModel.findOne.mockReturnValue(chain(null));
    await expect(service.replayFailedWebhook(tenantId, failedWebhookId)).rejects.toThrow(NotFoundException);
  });

  it('re-dispatches the persisted event/body and marks resolved on success', async () => {
    const doc = failedDoc();
    failedWebhookModel.findOne.mockReturnValue(chain(doc));
    const spy = jest.spyOn(service, 'dispatchPaymentEvent').mockResolvedValue(true);

    const result = await service.replayFailedWebhook(tenantId, failedWebhookId);

    expect(spy).toHaveBeenCalledWith('payment.paid', {
      paymentId: 'p1',
      orderId: 'o1',
      status: 'paid',
      amount: 100,
      tenantId,
    });
    expect(doc.resolved).toBe(true);
    expect(doc.save).toHaveBeenCalled();
    expect(result).toEqual({ delivered: true });
  });

  it('does not mark resolved when the redispatch itself fails again', async () => {
    const doc = failedDoc();
    failedWebhookModel.findOne.mockReturnValue(chain(doc));
    jest.spyOn(service, 'dispatchPaymentEvent').mockResolvedValue(false);

    const result = await service.replayFailedWebhook(tenantId, failedWebhookId);

    expect(doc.resolved).toBe(false);
    expect(doc.save).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: false });
  });
});

describe('PaymentWebhookDispatcherService.listFailedWebhooks (Loop 10)', () => {
  const tenantId = new Types.ObjectId().toString();
  const config: any = { get: jest.fn().mockReturnValue(undefined) };
  const failedWebhookModel: any = { find: jest.fn() };
  const service = new PaymentWebhookDispatcherService(config, failedWebhookModel);

  beforeEach(() => jest.clearAllMocks());

  it('filters by tenantId and resolved:false by default', async () => {
    failedWebhookModel.find.mockReturnValue(chain([]));
    await service.listFailedWebhooks(tenantId);
    expect(failedWebhookModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ resolved: false }),
    );
  });

  it('includes resolved ones when onlyUnresolved is false', async () => {
    failedWebhookModel.find.mockReturnValue(chain([]));
    await service.listFailedWebhooks(tenantId, false);
    const arg = failedWebhookModel.find.mock.calls[0][0];
    expect(arg.resolved).toBeUndefined();
  });
});
