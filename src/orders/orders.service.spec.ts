import { UnprocessableEntityException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ExcelSpreadsheetService } from '../common/excel/excel-spreadsheet.service';
import { ProductsService } from '../products/products.service';
import { PurchasesService } from '../purchases/purchases.service';
import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  const customerId = new Types.ObjectId();
  const variantId = new Types.ObjectId();
  const orderId = new Types.ObjectId();

  let service: OrdersService;
  let orderModel: {
    create: jest.Mock;
    findById: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
    findByIdAndDelete: jest.Mock;
  };
  let variantModel: { findById: jest.Mock; find: jest.Mock };
  let products: {
    applySaleDeductionsForOrder: jest.Mock;
    applySaleReversalsForOrder: jest.Mock;
  };
  let purchases: { sumPendingOutstandingByVariantIds: jest.Mock };

  beforeEach(() => {
    orderModel = {
      create: jest.fn(),
      findById: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
      findByIdAndDelete: jest.fn(),
    };
    variantModel = {
      findById: jest.fn(),
      find: jest.fn().mockReturnValue({
        lean: () => ({
          exec: () =>
            Promise.resolve([
              {
                _id: variantId,
                sku: 'SKU-P',
                quantityOnHand: 100,
              },
            ]),
        }),
      }),
    };
    products = {
      applySaleDeductionsForOrder: jest.fn().mockResolvedValue(undefined),
      applySaleReversalsForOrder: jest.fn().mockResolvedValue(undefined),
    };
    purchases = {
      sumPendingOutstandingByVariantIds: jest.fn().mockResolvedValue(new Map()),
    };
    const payments = {
      syncPaymentPaidForOrder: jest.fn().mockResolvedValue(undefined),
      cancelPendingForOrder: jest.fn().mockResolvedValue(undefined),
      createPixPayment: jest.fn(),
    };
    const excel = {} as ExcelSpreadsheetService;
    service = new OrdersService(
      orderModel as never,
      variantModel as never,
      excel,
      products as unknown as ProductsService,
      purchases as unknown as PurchasesService,
      payments as never,
    );
  });

  it('create paid deduz estoque após persistir', async () => {
    variantModel.findById.mockReturnValue({
      exec: () =>
        Promise.resolve({
          _id: variantId,
          sku: 'SKU-OK',
          quantityOnHand: 50,
        }),
    });
    variantModel.find.mockReturnValue({
      lean: () => ({
        exec: () =>
          Promise.resolve([
            { _id: variantId, sku: 'SKU-OK', quantityOnHand: 50 },
          ]),
      }),
    });
    orderModel.create.mockResolvedValue({
      _id: orderId,
      toObject: () => ({
        _id: orderId,
        customerId,
        status: 'paid',
        channel: 'online',
        lines: [
          {
            variantId,
            quantity: 2,
            unitPrice: 10,
          },
        ],
        total: 20,
      }),
    });

    await service.create(
      'mock-tenant-id',
      {
        customerId: customerId.toString(),
        status: 'open',
        lines: [
          {
            variantId: variantId.toString(),
            quantity: 2,
            unitPrice: 10,
          },
        ],
      },
      undefined,
    );

    expect(products.applySaleDeductionsForOrder).toHaveBeenCalledWith(
      orderId,
      [{ variantId, quantity: 2 }],
      undefined,
    );
  });

  it('create paid com estoque insuficiente retorna 422', async () => {
    variantModel.findById.mockReturnValue({
      exec: () =>
        Promise.resolve({
          _id: variantId,
          sku: 'SKU-LOW',
          quantityOnHand: 1,
        }),
    });
    variantModel.find.mockReturnValue({
      lean: () => ({
        exec: () =>
          Promise.resolve([
            { _id: variantId, sku: 'SKU-LOW', quantityOnHand: 1 },
          ]),
      }),
    });

    await expect(
      service.create('mock-tenant-id', {
        customerId: customerId.toString(),
        status: 'open',
        lines: [
          {
            variantId: variantId.toString(),
            quantity: 5,
            unitPrice: 1,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(orderModel.create).not.toHaveBeenCalled();
    expect(products.applySaleDeductionsForOrder).not.toHaveBeenCalled();
  });

  it('create draft não chama baixa de estoque', async () => {
    variantModel.findById.mockReturnValue({
      exec: () =>
        Promise.resolve({
          _id: variantId,
          sku: 'SKU-D',
          quantityOnHand: 1,
        }),
    });
    variantModel.find.mockReturnValue({
      lean: () => ({
        exec: () =>
          Promise.resolve([
            { _id: variantId, sku: 'SKU-D', quantityOnHand: 1 },
          ]),
      }),
    });
    orderModel.create.mockResolvedValue({
      _id: orderId,
      toObject: () => ({
        _id: orderId,
        customerId,
        status: 'draft',
        channel: 'online',
        lines: [
          {
            variantId,
            quantity: 5,
            unitPrice: 1,
          },
        ],
        total: 5,
      }),
    });

    await service.create('mock-tenant-id', {
      customerId: customerId.toString(),
      status: 'open',
      lines: [
        {
          variantId: variantId.toString(),
          quantity: 5,
          unitPrice: 1,
        },
      ],
    });

    expect(products.applySaleDeductionsForOrder).not.toHaveBeenCalled();
  });

  it('update mantendo paid não chama nova baixa de estoque', async () => {
    const line = {
      variantId,
      quantity: 1,
      unitPrice: 10,
    };
    const doc = {
      _id: orderId,
      status: 'paid',
      lines: [line],
      total: 10,
      channel: 'site',
      customerId,
      reference: 'old',
      notes: '',
      save: jest.fn().mockResolvedValue(undefined),
      toObject: () => ({
        _id: orderId,
        status: 'paid',
        lines: [line],
        total: 10,
        channel: 'site',
        customerId,
        reference: 'new',
      }),
    };
    orderModel.findById.mockReturnValue({
      exec: () => Promise.resolve(doc),
    });

    await service.update('mock-tenant-id', orderId.toString(), { reference: 'new' });

    expect(products.applySaleDeductionsForOrder).not.toHaveBeenCalled();
    expect(products.applySaleReversalsForOrder).not.toHaveBeenCalled();
  });

  it('update paid -> cancelled estorna estoque', async () => {
    const line = {
      variantId,
      quantity: 1,
      unitPrice: 10,
    };
    const doc = {
      _id: orderId,
      status: 'paid',
      lines: [line],
      total: 10,
      channel: 'site',
      customerId,
      reference: '',
      notes: '',
      save: jest.fn().mockResolvedValue(undefined),
      toObject: () => ({
        _id: orderId,
        status: 'cancelled',
        lines: [line],
        total: 10,
        channel: 'site',
        customerId,
      }),
    };
    orderModel.findById.mockReturnValue({
      exec: () => Promise.resolve(doc),
    });

    await service.update('mock-tenant-id', orderId.toString(), { status: 'cancelled' });

    expect(products.applySaleReversalsForOrder).toHaveBeenCalledWith(
      orderId,
      [{ variantId }],
      undefined,
    );
    expect(doc.save).toHaveBeenCalled();
  });

  it('buildWarnings inclui aviso de compra pendente', async () => {
    variantModel.findById.mockReturnValue({
      exec: () =>
        Promise.resolve({
          _id: variantId,
          sku: 'SKU-P',
          quantityOnHand: 100,
        }),
    });
    variantModel.find.mockReturnValue({
      lean: () => ({
        exec: () =>
          Promise.resolve([
            { _id: variantId, sku: 'SKU-P', quantityOnHand: 100 },
          ]),
      }),
    });
    const pending = new Map<string, number>();
    pending.set(variantId.toString(), 12);
    purchases.sumPendingOutstandingByVariantIds.mockResolvedValue(pending);

    orderModel.create.mockResolvedValue({
      _id: orderId,
      toObject: () => ({
        _id: orderId,
        customerId,
        status: 'draft',
        channel: 'online',
        lines: [
          {
            variantId,
            quantity: 1,
            unitPrice: 5,
          },
        ],
        total: 5,
      }),
    });

    const res = await service.create('mock-tenant-id', {
      customerId: customerId.toString(),
      status: 'open',
      lines: [
        {
          variantId: variantId.toString(),
          quantity: 1,
          unitPrice: 5,
        },
      ],
    });

    const pendWarn = res.warnings.find((w) => w.type === 'pending_purchase');
    expect(pendWarn).toBeDefined();
    expect(pendWarn?.pendingPurchaseQty).toBe(12);
  });
});
