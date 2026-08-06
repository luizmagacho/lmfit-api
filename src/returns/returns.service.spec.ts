import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ReturnsService } from './returns.service';

function chain<T>(value: T) {
  const c: any = { exec: jest.fn().mockResolvedValue(value) };
  c.lean = () => c;
  c.populate = () => c;
  c.sort = () => c;
  c.skip = () => c;
  c.limit = () => c;
  return c;
}

function orderDoc(overrides: Record<string, unknown> = {}) {
  const variantId = new Types.ObjectId();
  const doc: any = {
    _id: new Types.ObjectId(),
    tenantId: new Types.ObjectId(),
    customerId: new Types.ObjectId(),
    number: 42,
    status: 'shipped',
    createdAt: new Date(),
    lines: [
      { variantId, quantity: 2, unitPrice: 100, isOrder: false, returnedQty: 0, description: 'Camiseta P' },
    ],
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { doc, variantId };
}

describe('ReturnsService', () => {
  const tenantId = new Types.ObjectId().toString();
  const model: any = { create: jest.fn(), findOne: jest.fn(), find: jest.fn(), countDocuments: jest.fn() };
  const orderModel: any = { findOne: jest.fn() };
  const customerModel: any = { findOne: jest.fn(), findOneAndUpdate: jest.fn() };
  const paymentModel: any = { findOneAndUpdate: jest.fn() };
  const products: any = { applyStockMovementWithOrderMeta: jest.fn().mockResolvedValue(undefined) };
  const tenants: any = { findById: jest.fn() };
  const notifications: any = { logStaffAlert: jest.fn(), sendEmail: jest.fn().mockResolvedValue(undefined) };

  const service = new ReturnsService(model, orderModel, customerModel, paymentModel, products, tenants, notifications);

  beforeEach(() => {
    jest.clearAllMocks();
    tenants.findById.mockResolvedValue({ storefront: { returnPolicy: { windowDays: 30 } } });
    customerModel.findOneAndUpdate.mockReturnValue(chain({}));
    paymentModel.findOneAndUpdate.mockReturnValue(chain({}));
  });

  describe('create — staff-immediate path (unchanged behavior)', () => {
    it('executes stock reversal + credit immediately and sets status completed', async () => {
      const { doc, variantId } = orderDoc();
      orderModel.findOne.mockReturnValue(chain(doc));
      model.create.mockImplementation((data: any) => Promise.resolve({ ...data, toObject: () => data }));

      const result = await service.create(tenantId, String(doc._id), {
        type: 'return',
        lines: [{ variantId: String(variantId), quantity: 1 }],
      });

      expect(products.applyStockMovementWithOrderMeta).toHaveBeenCalledWith(
        tenantId,
        String(variantId),
        expect.objectContaining({ delta: 1 }),
        undefined,
        doc._id,
      );
      expect(customerModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: doc.customerId }),
        { $inc: { storeCreditBalance: 100 } },
      );
      expect(doc.save).toHaveBeenCalled();
      expect(result.status).toBe('completed');
      expect(result.requestedBy).toBe('staff');
    });

    it('rejects orders not in shipped/completed status', async () => {
      const { doc } = orderDoc({ status: 'open' });
      orderModel.findOne.mockReturnValue(chain(doc));
      await expect(
        service.create(tenantId, String(doc._id), { type: 'return', lines: [] }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create — type: "refund" (Loop 17, manual refund tracking)', () => {
    it('marks the order\'s paid Payment as refunded instead of crediting store balance, with no PSP API call', async () => {
      const { doc, variantId } = orderDoc();
      orderModel.findOne.mockReturnValue(chain(doc));
      model.create.mockImplementation((data: any) => Promise.resolve({ ...data, toObject: () => data }));

      const staffUserId = new Types.ObjectId().toString();
      const result = await service.create(
        tenantId,
        String(doc._id),
        { type: 'refund', lines: [{ variantId: String(variantId), quantity: 1 }] },
        staffUserId,
      );

      // Regression: creditIssued used to be hardcoded to 0 for anything but 'return', even though
      // applyReturnEffects had already computed and applied the real refunded amount.
      expect(result.creditIssued).toBe(100);

      expect(paymentModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: expect.anything(), orderId: doc._id, status: 'paid' }),
        expect.objectContaining({
          $set: expect.objectContaining({
            refundAmount: 100,
            refundedBy: expect.anything(),
            refundedAt: expect.any(Date),
          }),
        }),
        expect.objectContaining({ sort: { paidAt: -1 } }),
      );
      // Nunca credita storeCreditBalance para um estorno — só para 'return'.
      expect(customerModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('does not touch Payment at all for a plain exchange (no monetary effect)', async () => {
      const { doc, variantId } = orderDoc();
      orderModel.findOne.mockReturnValue(chain(doc));
      model.create.mockImplementation((data: any) => Promise.resolve({ ...data, toObject: () => data }));

      await service.create(tenantId, String(doc._id), {
        type: 'exchange',
        lines: [{ variantId: String(variantId), quantity: 1 }],
      });

      expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(customerModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('requestFromCustomer — Loop 8 (AC4: window enforcement)', () => {
    it('creates a status:"requested" record without applying stock/credit effects', async () => {
      const { doc, variantId } = orderDoc();
      orderModel.findOne.mockReturnValue(chain(doc));
      model.create.mockImplementation((data: any) => Promise.resolve({ ...data, _id: 'r1', toObject: () => data }));

      const result = await service.requestFromCustomer(tenantId, String(doc.customerId), String(doc._id), {
        type: 'return',
        lines: [{ variantId: String(variantId), quantity: 1 }],
      });

      expect(products.applyStockMovementWithOrderMeta).not.toHaveBeenCalled();
      expect(customerModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(doc.save).not.toHaveBeenCalled();
      expect(result.status).toBe('requested');
      expect(result.requestedBy).toBe('customer');
      expect(notifications.logStaffAlert).toHaveBeenCalledWith('return_requested', expect.objectContaining({ orderNumber: 42 }));
    });

    it('rejects a request outside the configured return window', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40);
      const { doc, variantId } = orderDoc({ createdAt: oldDate });
      orderModel.findOne.mockReturnValue(chain(doc));
      tenants.findById.mockResolvedValue({ storefront: { returnPolicy: { windowDays: 30 } } });

      await expect(
        service.requestFromCustomer(tenantId, String(doc.customerId), String(doc._id), {
          type: 'return',
          lines: [{ variantId: String(variantId), quantity: 1 }],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('falls back to a default window when the tenant has no returnPolicy configured', async () => {
      const { doc, variantId } = orderDoc();
      orderModel.findOne.mockReturnValue(chain(doc));
      tenants.findById.mockResolvedValue({ storefront: {} });
      model.create.mockImplementation((data: any) => Promise.resolve({ ...data, toObject: () => data }));

      await expect(
        service.requestFromCustomer(tenantId, String(doc.customerId), String(doc._id), {
          type: 'return',
          lines: [{ variantId: String(variantId), quantity: 1 }],
        }),
      ).resolves.toBeDefined();
    });

    it('rejects when the order does not belong to the requesting customer', async () => {
      const { doc, variantId } = orderDoc();
      orderModel.findOne.mockReturnValue(chain(doc));
      await expect(
        service.requestFromCustomer(tenantId, new Types.ObjectId().toString(), String(doc._id), {
          type: 'return',
          lines: [{ variantId: String(variantId), quantity: 1 }],
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('resolveOrderForGuest — AC5 (generic error, no existence leak)', () => {
    it('rejects with a generic message when the phone does not match the order customer', async () => {
      const { doc } = orderDoc();
      orderModel.findOne.mockReturnValue(chain(doc));
      customerModel.findOne.mockReturnValue(chain({ phone: '11999990000' }));
      await expect(service.resolveOrderForGuest(tenantId, 42, '11888887777')).rejects.toThrow(NotFoundException);
    });

    it('rejects with the same generic message when the order number does not exist', async () => {
      orderModel.findOne.mockReturnValue(chain(null));
      await expect(service.resolveOrderForGuest(tenantId, 999, '11999990000')).rejects.toThrow(NotFoundException);
    });

    it('resolves when the phone matches regardless of formatting (digits-only comparison)', async () => {
      const { doc } = orderDoc();
      orderModel.findOne.mockReturnValue(chain(doc));
      customerModel.findOne.mockReturnValue(chain({ phone: '(11) 99999-0000' }));
      await expect(service.resolveOrderForGuest(tenantId, 42, '11999990000')).resolves.toBe(doc);
    });
  });

  describe('approve/reject — AC1-AC3 (review workflow)', () => {
    function requestedRecord(overrides: Record<string, unknown> = {}) {
      const variantId = new Types.ObjectId();
      const orderId = new Types.ObjectId();
      const customerId = new Types.ObjectId();
      const rec: any = {
        _id: new Types.ObjectId(),
        tenantId: new Types.ObjectId(tenantId),
        orderId,
        customerId,
        type: 'return',
        status: 'requested',
        lines: [{ variantId, quantity: 1, unitPrice: 0 }],
        save: jest.fn().mockResolvedValue(undefined),
        toObject() {
          return { ...rec };
        },
        ...overrides,
      };
      return { rec, variantId, orderId, customerId };
    }

    it('approve executes the same stock/credit effect and e-mails the buyer', async () => {
      const { rec, variantId, orderId } = requestedRecord();
      model.findOne.mockReturnValue(chain(rec));
      const { doc } = orderDoc({ _id: orderId, lines: [{ variantId, quantity: 1, unitPrice: 50, isOrder: false, returnedQty: 0 }] });
      orderModel.findOne.mockReturnValue(chain(doc));
      customerModel.findOne.mockReturnValue(chain({ email: 'buyer@x.com' }));

      const staffId = new Types.ObjectId().toString();
      const result = await service.approve(tenantId, String(rec._id), staffId);

      expect(products.applyStockMovementWithOrderMeta).toHaveBeenCalled();
      expect(customerModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        { $inc: { storeCreditBalance: 50 } },
      );
      expect(rec.status).toBe('completed');
      expect(notifications.sendEmail).toHaveBeenCalledWith('buyer@x.com', expect.any(String), expect.any(String));
      expect(result.status).toBe('completed');
    });

    it('approve rejects a request that was already reviewed (one-way transition guard)', async () => {
      const { rec } = requestedRecord({ status: 'approved' });
      model.findOne.mockReturnValue(chain(rec));
      await expect(service.approve(tenantId, String(rec._id), new Types.ObjectId().toString())).rejects.toThrow(BadRequestException);
      expect(products.applyStockMovementWithOrderMeta).not.toHaveBeenCalled();
    });

    it('reject leaves stock/credit untouched and e-mails the buyer with the note', async () => {
      const { rec, orderId } = requestedRecord();
      model.findOne.mockReturnValue(chain(rec));
      const { doc } = orderDoc({ _id: orderId });
      orderModel.findOne.mockReturnValue(chain(doc));
      customerModel.findOne.mockReturnValue(chain({ email: 'buyer@x.com' }));

      await service.reject(tenantId, String(rec._id), new Types.ObjectId().toString(), 'Fora do prazo');

      expect(products.applyStockMovementWithOrderMeta).not.toHaveBeenCalled();
      expect(customerModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(rec.status).toBe('rejected');
      expect(rec.rejectionNote).toBe('Fora do prazo');
      expect(notifications.sendEmail).toHaveBeenCalledWith(
        'buyer@x.com',
        expect.any(String),
        expect.stringContaining('Fora do prazo'),
      );
    });

    it('reject rejects a request that was already reviewed', async () => {
      const { rec } = requestedRecord({ status: 'rejected' });
      model.findOne.mockReturnValue(chain(rec));
      await expect(service.reject(tenantId, String(rec._id), new Types.ObjectId().toString())).rejects.toThrow(BadRequestException);
    });
  });

  describe('notifyCustomer — best-effort e-mail (mirrors Loop 7)', () => {
    it('approve does not throw when the buyer e-mail send fails', async () => {
      const { rec, variantId, orderId } = requestedRecord();
      model.findOne.mockReturnValue(chain(rec));
      const { doc } = orderDoc({ _id: orderId, lines: [{ variantId, quantity: 1, unitPrice: 50, isOrder: false, returnedQty: 0 }] });
      orderModel.findOne.mockReturnValue(chain(doc));
      customerModel.findOne.mockReturnValue(chain({ email: 'buyer@x.com' }));
      notifications.sendEmail.mockRejectedValueOnce(new Error('smtp down'));

      await expect(service.approve(tenantId, String(rec._id), new Types.ObjectId().toString())).resolves.toBeDefined();
    });

    function requestedRecord(overrides: Record<string, unknown> = {}) {
      const variantId = new Types.ObjectId();
      const orderId = new Types.ObjectId();
      const customerId = new Types.ObjectId();
      const rec: any = {
        _id: new Types.ObjectId(),
        tenantId: new Types.ObjectId(tenantId),
        orderId,
        customerId,
        type: 'return',
        status: 'requested',
        lines: [{ variantId, quantity: 1, unitPrice: 0 }],
        save: jest.fn().mockResolvedValue(undefined),
        toObject() {
          return { ...rec };
        },
        ...overrides,
      };
      return { rec, variantId, orderId, customerId };
    }
  });
});
