import { Types } from 'mongoose';
import { AbandonedCartCron } from './abandoned-cart.cron';

function chain<T>(value: T) {
  const c: any = { exec: jest.fn().mockResolvedValue(value) };
  c.lean = () => c;
  c.select = () => c;
  c.populate = () => c;
  c.sort = () => c;
  return c;
}

function draft(overrides: Record<string, unknown> = {}) {
  const doc: any = {
    _id: new Types.ObjectId(),
    tenantId: new Types.ObjectId(),
    lines: [{ variantId: new Types.ObjectId(), quantity: 2, unitPrice: 50 }],
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return doc;
}

describe('AbandonedCartCron.checkAbandonedCarts', () => {
  const draftModel: any = { find: jest.fn() };
  const variantModel: any = { find: jest.fn() };
  const customerModel: any = { findById: jest.fn() };
  const notify: any = { sendEmail: jest.fn().mockResolvedValue(undefined) };
  const config: any = { get: jest.fn() };

  const cron = new AbandonedCartCron(draftModel, variantModel, customerModel, notify, config);

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockReturnValue(undefined);
  });

  it('queries only drafts with no order, not yet notified, old enough, and with at least one line', async () => {
    draftModel.find.mockReturnValue(chain([]));

    await cron.checkAbandonedCarts();

    expect(draftModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: { $exists: false },
        abandonedNotifiedAt: { $exists: false },
        'lines.0': { $exists: true },
      }),
    );
  });

  it('sends a recovery email using the email captured in checkout metadata', async () => {
    const d = draft({ metadata: { customer: { email: 'ana@example.com' } } });
    draftModel.find.mockReturnValue(chain([d]));
    variantModel.find.mockReturnValue(
      chain([{ _id: d.lines[0].variantId, productId: { name: 'Legging Preta', slug: 'legging-preta' } }]),
    );

    await cron.checkAbandonedCarts();

    expect(notify.sendEmail).toHaveBeenCalledWith(
      'ana@example.com',
      expect.stringContaining('sacola'),
      expect.stringContaining('Legging Preta'),
      expect.stringContaining('legging-preta'),
    );
    expect(d.abandonedNotifiedAt).toBeInstanceOf(Date);
    expect(d.save).toHaveBeenCalled();
  });

  it('falls back to the logged-in customer record when checkout metadata has no email', async () => {
    const d = draft({ customerId: new Types.ObjectId(), metadata: {} });
    draftModel.find.mockReturnValue(chain([d]));
    customerModel.findById.mockReturnValue(chain({ email: 'from-account@example.com' }));
    variantModel.find.mockReturnValue(chain([{ _id: d.lines[0].variantId, productId: { name: 'Produto X', slug: 'produto-x' } }]));

    await cron.checkAbandonedCarts();

    expect(notify.sendEmail).toHaveBeenCalledWith(
      'from-account@example.com',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('skips (without sending) and still marks notified when no email is available anywhere — the documented WhatsApp-only carry-over case', async () => {
    const d = draft({ metadata: { customer: { phone: '5511999998888' } } });
    draftModel.find.mockReturnValue(chain([d]));

    await cron.checkAbandonedCarts();

    expect(notify.sendEmail).not.toHaveBeenCalled();
    expect(d.abandonedNotifiedAt).toBeInstanceOf(Date);
    expect(d.save).toHaveBeenCalled();
  });

  it('does not mark the draft as notified when the email send itself throws, so it retries next run', async () => {
    const d = draft({ metadata: { customer: { email: 'ana@example.com' } } });
    draftModel.find.mockReturnValue(chain([d]));
    variantModel.find.mockReturnValue(chain([{ _id: d.lines[0].variantId, productId: { name: 'X', slug: 'x' } }]));
    notify.sendEmail.mockRejectedValueOnce(new Error('SMTP down'));

    await cron.checkAbandonedCarts();

    expect(d.abandonedNotifiedAt).toBeUndefined();
    expect(d.save).not.toHaveBeenCalled();
  });

  it('processes one draft failing independently of another succeeding', async () => {
    const broken = draft({ metadata: { customer: { email: 'broken@example.com' } } });
    const ok = draft({ metadata: { customer: { email: 'ok@example.com' } } });
    draftModel.find.mockReturnValue(chain([broken, ok]));
    variantModel.find.mockReturnValue(chain([{ _id: broken.lines[0].variantId, productId: { name: 'X', slug: 'x' } }]));
    notify.sendEmail.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);

    await cron.checkAbandonedCarts();

    expect(broken.save).not.toHaveBeenCalled();
    expect(ok.save).toHaveBeenCalled();
  });

  it('respects a configured ABANDONED_CART_HOURS threshold', async () => {
    config.get.mockImplementation((key: string) => (key === 'ABANDONED_CART_HOURS' ? '6' : undefined));
    draftModel.find.mockReturnValue(chain([]));

    const before = Date.now();
    await cron.checkAbandonedCarts();

    const call = draftModel.find.mock.calls[0][0];
    const cutoff = call.updatedAt.$lte as Date;
    const hoursApplied = (before - cutoff.getTime()) / (60 * 60 * 1000);
    expect(hoursApplied).toBeGreaterThan(5.9);
    expect(hoursApplied).toBeLessThan(6.1);
  });
});
