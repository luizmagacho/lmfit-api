import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OrdersService } from './orders.service';
import { Order } from './schemas/order.schema';
import { ProductVariant } from '../products/schemas/product-variant.schema';
import { ExcelSpreadsheetService } from '../common/excel/excel-spreadsheet.service';
import { ProductsService } from '../products/products.service';
import { PurchasesService } from '../purchases/purchases.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { PromotionsService } from '../promotions/promotions.service';
import { PaymentsService } from '../payments/payments.service';
import { Payment } from '../payments/schemas/payment.schema';
import { Customer } from '../customers/schemas/customer.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { CountersService } from '../common/counters/counters.service';

function chain<T>(value: T) {
  const c: any = { exec: jest.fn().mockResolvedValue(value) };
  c.lean = () => c;
  return c;
}

describe('OrdersService.create — wholesale re-validation on staff/PDV orders', () => {
  let service: OrdersService;
  const tenantId = new Types.ObjectId().toString();
  const variantId = new Types.ObjectId().toString();
  const customerId = new Types.ObjectId().toString();

  const variantModel = { find: jest.fn() };
  const orderModel: any = { create: jest.fn(), countDocuments: jest.fn() };
  const products = { getWholesalePricingBatch: jest.fn(), applySaleDeductionsForOrder: jest.fn() };
  const purchases = { sumPendingOutstandingByVariantIds: jest.fn() };
  const loyalty = { creditForOrder: jest.fn() };
  const promotions = { redeem: jest.fn() };
  const counters = { next: jest.fn().mockResolvedValue(1) };

  beforeEach(async () => {
    jest.clearAllMocks();
    variantModel.find.mockReturnValue(
      chain([{ _id: variantId, sku: 'CAM-P', quantityOnHand: 100 }]),
    );
    orderModel.countDocuments.mockReturnValue(chain(0));
    purchases.sumPendingOutstandingByVariantIds.mockResolvedValue(new Map());
    counters.next.mockResolvedValue(1);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: getModelToken(ProductVariant.name), useValue: variantModel },
        { provide: ExcelSpreadsheetService, useValue: {} },
        { provide: ProductsService, useValue: products },
        { provide: PurchasesService, useValue: purchases },
        { provide: LoyaltyService, useValue: loyalty },
        { provide: PromotionsService, useValue: promotions },
        { provide: PaymentsService, useValue: {} },
        { provide: getModelToken(Payment.name), useValue: {} },
        { provide: getModelToken(Customer.name), useValue: {} },
        { provide: NotificationsService, useValue: { sendEmail: jest.fn() } },
        { provide: CountersService, useValue: counters },
      ],
    }).compile();
    service = module.get<OrdersService>(OrdersService);
  });

  const baseDto = (unitPrice: number, quantity: number) => ({
    customerId,
    lines: [{ variantId, quantity, unitPrice, productionPrice: 0 }],
  });

  it('rejects a staff-typed price at/under the wholesale rate when quantity is below the minimum', async () => {
    products.getWholesalePricingBatch.mockResolvedValue(
      new Map([[variantId, { priceRetail: 50, priceWholesale: 35, minWholesaleQty: 12 }]]),
    );

    // 3 units at the wholesale price (35) — real atacado rule requires 12+.
    await expect(service.create(tenantId, baseDto(35, 3) as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(orderModel.create).not.toHaveBeenCalled();
  });

  it('allows the wholesale price once quantity meets the minimum', async () => {
    products.getWholesalePricingBatch.mockResolvedValue(
      new Map([[variantId, { priceRetail: 50, priceWholesale: 35, minWholesaleQty: 12 }]]),
    );
    orderModel.create.mockResolvedValue({
      _id: new Types.ObjectId(),
      customerId,
      toObject: () => ({ _id: 'order-1' }),
    });

    await expect(service.create(tenantId, baseDto(35, 12) as any)).resolves.toBeDefined();
    expect(orderModel.create).toHaveBeenCalled();
  });

  it('allows a manual discount below retail that still sits above the wholesale rate', async () => {
    products.getWholesalePricingBatch.mockResolvedValue(
      new Map([[variantId, { priceRetail: 50, priceWholesale: 35, minWholesaleQty: 12 }]]),
    );
    orderModel.create.mockResolvedValue({
      _id: new Types.ObjectId(),
      customerId,
      toObject: () => ({ _id: 'order-1' }),
    });

    // 1 unit at 40 — below retail (staff discount) but still above the wholesale floor,
    // so the minimum-quantity rule does not apply.
    await expect(service.create(tenantId, baseDto(40, 1) as any)).resolves.toBeDefined();
  });
});

describe('OrdersService.findAll — search input is regex-escaped', () => {
  let service: OrdersService;
  const tenantId = new Types.ObjectId().toString();
  const orderModel: any = { find: jest.fn(), countDocuments: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const findChain: any = { sort: () => findChain, skip: () => findChain, limit: () => findChain, lean: () => Promise.resolve([]) };
    orderModel.find.mockReturnValue(findChain);
    orderModel.countDocuments.mockReturnValue(chain(0));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: getModelToken(ProductVariant.name), useValue: {} },
        { provide: ExcelSpreadsheetService, useValue: {} },
        { provide: ProductsService, useValue: {} },
        { provide: PurchasesService, useValue: {} },
        { provide: LoyaltyService, useValue: {} },
        { provide: PromotionsService, useValue: {} },
        { provide: PaymentsService, useValue: {} },
        { provide: getModelToken(Payment.name), useValue: {} },
        { provide: getModelToken(Customer.name), useValue: {} },
        { provide: NotificationsService, useValue: { sendEmail: jest.fn() } },
        { provide: CountersService, useValue: { next: jest.fn().mockResolvedValue(1) } },
      ],
    }).compile();
    service = module.get<OrdersService>(OrdersService);
  });

  // Regression: `search` used to be interpolated straight into `new RegExp(search, 'i')`.
  // A client could submit regex metacharacters (nested quantifiers) that make MongoDB's
  // regex matcher hang evaluating a single document (ReDoS). Special characters must be
  // escaped before reaching RegExp.
  it('escapes regex metacharacters instead of passing raw user input to RegExp', async () => {
    await service.findAll(tenantId, 1, 20, '(a+)+$');

    const filter = orderModel.find.mock.calls[0][0];
    const orClause = filter.$and.find((p: any) => p.$or)?.$or ?? [];
    const referenceRegex = orClause.find((c: any) => c.reference)?.reference as RegExp;
    expect(referenceRegex).toBeInstanceOf(RegExp);
    // The escaped source must not contain a bare, un-escaped '+' next to a group —
    // every metacharacter from the input is backslash-escaped in the compiled source.
    expect(referenceRegex.source).toBe('\\(a\\+\\)\\+\\$');
  });
});

describe('OrdersService.update — shipped-notification idempotency (Loop 8, AC7)', () => {
  let service: OrdersService;
  const tenantId = new Types.ObjectId().toString();
  const customerId = new Types.ObjectId();
  const orderModel: any = { findOne: jest.fn() };
  const variantModel: any = { find: jest.fn() };
  const customerModel: any = { findOne: jest.fn() };
  const purchases = { sumPendingOutstandingByVariantIds: jest.fn().mockResolvedValue(new Map()) };
  const products = {
    applySaleDeductionsForOrder: jest.fn().mockResolvedValue(undefined),
    applySaleReversalsForOrder: jest.fn().mockResolvedValue(undefined),
  };
  const payments = { syncPaymentPaidForOrder: jest.fn(), cancelPendingForOrder: jest.fn() };
  const loyalty = { creditForOrder: jest.fn() };
  const notifications = { sendEmail: jest.fn().mockResolvedValue(undefined) };

  const fixedVariantId = new Types.ObjectId();

  function orderDoc() {
    const doc: any = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(tenantId),
      customerId,
      number: 77,
      channel: 'online',
      status: 'picking',
      lines: [{ variantId: fixedVariantId, quantity: 1, unitPrice: 100, isOrder: false }],
      total: 100,
      toObject() {
        return { ...doc };
      },
      save: jest.fn().mockResolvedValue(undefined),
    };
    return doc;
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    variantModel.find.mockReturnValue(chain([{ _id: fixedVariantId, sku: 'SKU-1', quantityOnHand: 10 }]));
    customerModel.findOne.mockReturnValue(chain({ email: 'buyer@x.com' }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: getModelToken(ProductVariant.name), useValue: variantModel },
        { provide: getModelToken(Payment.name), useValue: {} },
        { provide: getModelToken(Customer.name), useValue: customerModel },
        { provide: ExcelSpreadsheetService, useValue: {} },
        { provide: ProductsService, useValue: products },
        { provide: PurchasesService, useValue: purchases },
        { provide: LoyaltyService, useValue: loyalty },
        { provide: PromotionsService, useValue: promotionsStub() },
        { provide: PaymentsService, useValue: payments },
        { provide: NotificationsService, useValue: notifications },
        { provide: CountersService, useValue: { next: jest.fn().mockResolvedValue(1) } },
      ],
    }).compile();
    service = module.get<OrdersService>(OrdersService);
  });

  function promotionsStub() {
    return {};
  }

  it('sends exactly one buyer e-mail on the first transition into "shipped"', async () => {
    const doc = orderDoc();
    orderModel.findOne.mockReturnValue(chain(doc));

    await service.update(tenantId, String(doc._id), { status: 'shipped' } as any);

    expect(notifications.sendEmail).toHaveBeenCalledTimes(1);
    expect(notifications.sendEmail).toHaveBeenCalledWith(
      'buyer@x.com',
      expect.stringContaining('77'),
      expect.any(String),
    );
    expect(doc.shippedNotifiedAt).toBeInstanceOf(Date);
  });

  it('never re-sends once shippedNotifiedAt is set, even after cycling back through "shipped" again', async () => {
    const doc = orderDoc();
    orderModel.findOne.mockReturnValue(chain(doc));

    // 1st: picking -> shipped (real transition, sends the e-mail)
    await service.update(tenantId, String(doc._id), { status: 'shipped' } as any);
    // 2nd: shipped -> completed (not a shipped-transition, no e-mail)
    await service.update(tenantId, String(doc._id), { status: 'completed' } as any);
    // 3rd: completed -> shipped again (oldStatus !== 'shipped' is true, but shippedNotifiedAt already set)
    await service.update(tenantId, String(doc._id), { status: 'shipped' } as any);

    expect(notifications.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('sets carrier/trackingCode/trackingUrl when provided (Loop 17, real order tracking)', async () => {
    const doc = orderDoc();
    orderModel.findOne.mockReturnValue(chain(doc));

    await service.update(tenantId, String(doc._id), {
      status: 'shipped',
      carrier: 'Correios',
      trackingCode: 'BR123456789BR',
      trackingUrl: 'https://rastreamento.correios.com.br/app/index.php?codigo=BR123456789BR',
    } as any);

    expect(doc.carrier).toBe('Correios');
    expect(doc.trackingCode).toBe('BR123456789BR');
    expect(doc.trackingUrl).toContain('BR123456789BR');
  });

  it('leaves tracking fields untouched when not provided in the patch', async () => {
    const doc = orderDoc();
    doc.carrier = 'Jadlog';
    doc.trackingCode = 'JD999';
    orderModel.findOne.mockReturnValue(chain(doc));

    await service.update(tenantId, String(doc._id), { status: 'completed' } as any);

    expect(doc.carrier).toBe('Jadlog');
    expect(doc.trackingCode).toBe('JD999');
  });
});

describe('OrdersService.findAllForCustomer — real order tracking reaches /conta (Loop 17)', () => {
  let service: OrdersService;
  const tenantId = new Types.ObjectId().toString();
  const customerId = new Types.ObjectId().toString();
  const orderModel: any = { find: jest.fn(), countDocuments: jest.fn() };
  const paymentModel: any = { find: jest.fn() };

  function queryChain<T>(value: T) {
    const c: any = {};
    c.select = jest.fn().mockReturnValue(c);
    c.sort = jest.fn().mockReturnValue(c);
    c.skip = jest.fn().mockReturnValue(c);
    c.limit = jest.fn().mockReturnValue(c);
    c.lean = jest.fn().mockReturnValue(c);
    c.exec = jest.fn().mockResolvedValue(value);
    return c;
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: getModelToken(ProductVariant.name), useValue: {} },
        { provide: getModelToken(Payment.name), useValue: paymentModel },
        { provide: getModelToken(Customer.name), useValue: {} },
        { provide: ExcelSpreadsheetService, useValue: {} },
        { provide: ProductsService, useValue: {} },
        { provide: PurchasesService, useValue: {} },
        { provide: LoyaltyService, useValue: {} },
        { provide: PromotionsService, useValue: {} },
        { provide: PaymentsService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: CountersService, useValue: { next: jest.fn().mockResolvedValue(1) } },
      ],
    }).compile();
    service = module.get<OrdersService>(OrdersService);
  });

  it('projects carrier/trackingCode/trackingUrl in the Mongo select (previously missing → invisible to /conta)', async () => {
    const findChain = queryChain([]);
    orderModel.find.mockReturnValue(findChain);
    orderModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

    await service.findAllForCustomer(tenantId, customerId, 1, 20);

    expect(findChain.select).toHaveBeenCalledWith(expect.stringContaining('carrier'));
    expect(findChain.select).toHaveBeenCalledWith(expect.stringContaining('trackingCode'));
    expect(findChain.select).toHaveBeenCalledWith(expect.stringContaining('trackingUrl'));
  });

  it('includes carrier/trackingCode/trackingUrl in the mapped response (previously dropped even after selecting them)', async () => {
    const orderId = new Types.ObjectId();
    const findChain = queryChain([
      {
        _id: orderId,
        number: 42,
        status: 'shipped',
        total: 199.9,
        shippingMethod: 'standard',
        shippingCost: 19.9,
        carrier: 'Correios',
        trackingCode: 'BR123456789BR',
        trackingUrl: 'https://rastreamento.correios.com.br/app/index.php?codigo=BR123456789BR',
        lines: [],
        createdAt: new Date(),
      },
    ]);
    orderModel.find.mockReturnValue(findChain);
    orderModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(1) });
    paymentModel.find.mockReturnValue(queryChain([]));

    const result = await service.findAllForCustomer(tenantId, customerId, 1, 20);

    expect(result.items[0]).toMatchObject({
      carrier: 'Correios',
      trackingCode: 'BR123456789BR',
      trackingUrl: 'https://rastreamento.correios.com.br/app/index.php?codigo=BR123456789BR',
    });
  });

  it('returns null (not undefined/crash) for tracking fields when an order has none yet', async () => {
    const findChain = queryChain([
      {
        _id: new Types.ObjectId(),
        number: 1,
        status: 'open',
        total: 50,
        lines: [],
        createdAt: new Date(),
      },
    ]);
    orderModel.find.mockReturnValue(findChain);
    orderModel.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(1) });
    paymentModel.find.mockReturnValue(queryChain([]));

    const result = await service.findAllForCustomer(tenantId, customerId, 1, 20);

    expect(result.items[0].carrier).toBeNull();
    expect(result.items[0].trackingCode).toBeNull();
    expect(result.items[0].trackingUrl).toBeNull();
  });
});

describe('OrdersService.syncBatch — offline PDV sync (Loop PDV-OFF-4)', () => {
  let service: OrdersService;
  const tenantId = new Types.ObjectId().toString();
  const variantId = new Types.ObjectId().toString();
  const customerId = new Types.ObjectId().toString();
  const locationId = new Types.ObjectId().toString();

  const variantModel = { find: jest.fn() };
  const orderModel: any = { create: jest.fn(), findOne: jest.fn() };
  const products = {
    getWholesalePricingBatch: jest.fn(),
    reserveForOfflineSale: jest.fn(),
    applySaleReversalForOrderVariant: jest.fn(),
  };
  const purchases = { sumPendingOutstandingByVariantIds: jest.fn() };
  const loyalty = { creditForOrder: jest.fn() };
  const promotions = { redeem: jest.fn() };
  const counters = { next: jest.fn() };
  const notifications = {
    sendEmail: jest.fn(),
    sendStaffEmail: jest.fn().mockResolvedValue(undefined),
    logStaffAlert: jest.fn(),
  };

  const baseSale = (quantity = 3, overrides: Record<string, unknown> = {}) => ({
    clientSaleId: 'client-sale-1',
    customerId,
    paymentMethod: 'cash' as const,
    lines: [{ variantId, quantity, unitPrice: 20, productionPrice: 0 }],
    createdAtLocal: new Date().toISOString(),
    ...overrides,
  });

  function orderDocFromCreate(doc: Record<string, unknown>) {
    return { ...doc, toObject: () => doc };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    variantModel.find.mockReturnValue(chain([{ _id: variantId, sku: 'CAM-P', quantityOnHand: 100 }]));
    products.getWholesalePricingBatch.mockResolvedValue(new Map());
    products.applySaleReversalForOrderVariant.mockResolvedValue(undefined);
    notifications.sendStaffEmail.mockResolvedValue(undefined);
    orderModel.findOne.mockReturnValue(chain(null));
    orderModel.create.mockImplementation(async (doc: Record<string, unknown>) => orderDocFromCreate(doc));
    counters.next.mockResolvedValue(11);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: getModelToken(ProductVariant.name), useValue: variantModel },
        { provide: ExcelSpreadsheetService, useValue: {} },
        { provide: ProductsService, useValue: products },
        { provide: PurchasesService, useValue: purchases },
        { provide: LoyaltyService, useValue: loyalty },
        { provide: PromotionsService, useValue: promotions },
        { provide: PaymentsService, useValue: {} },
        { provide: getModelToken(Payment.name), useValue: {} },
        { provide: getModelToken(Customer.name), useValue: {} },
        { provide: NotificationsService, useValue: notifications },
        { provide: CountersService, useValue: counters },
      ],
    }).compile();
    service = module.get<OrdersService>(OrdersService);
  });

  it('AC: replaying the same clientSaleId returns the already-created order without touching stock again', async () => {
    const existingOrder = {
      _id: new Types.ObjectId(),
      number: 7,
      clientSaleId: 'client-sale-1',
      autoBackorderedAt: undefined,
    };
    orderModel.findOne.mockReturnValue(chain(existingOrder));

    const [result] = await service.syncBatch(tenantId, locationId, [baseSale()]);

    expect(result).toEqual({
      clientSaleId: 'client-sale-1',
      orderId: String(existingOrder._id),
      orderNumber: 7,
      status: 'ok',
    });
    expect(products.reserveForOfflineSale).not.toHaveBeenCalled();
    expect(orderModel.create).not.toHaveBeenCalled();
  });

  it('AC: reports partial_backorder when replaying a clientSaleId whose order was auto-downgraded', async () => {
    const existingOrder = {
      _id: new Types.ObjectId(),
      number: 7,
      clientSaleId: 'client-sale-1',
      autoBackorderedAt: new Date(),
    };
    orderModel.findOne.mockReturnValue(chain(existingOrder));

    const [result] = await service.syncBatch(tenantId, locationId, [baseSale()]);

    expect(result.status).toBe('partial_backorder');
  });

  it('AC: a sale fully covered by the location creates a normal completed order', async () => {
    products.reserveForOfflineSale.mockResolvedValue(3);

    const [result] = await service.syncBatch(tenantId, locationId, [baseSale(3)]);

    expect(result.status).toBe('ok');
    expect(result.downgradedLines).toBeUndefined();
    const created = orderModel.create.mock.calls[0][0];
    expect(created.status).toBe('completed');
    expect(created.lines).toHaveLength(1);
    expect(created.lines[0]).toMatchObject({ quantity: 3, isOrder: false });
    expect(created.autoBackorderedAt).toBeUndefined();
    expect(notifications.sendStaffEmail).not.toHaveBeenCalled();
    expect(notifications.logStaffAlert).not.toHaveBeenCalled();
  });

  it('AC: a sale exceeding the location allocation but covered by tenant total splits into a backorder line, never throws', async () => {
    products.reserveForOfflineSale.mockResolvedValue(2); // only 2 of the 3 requested were available

    const [result] = await service.syncBatch(tenantId, locationId, [baseSale(3)]);

    expect(result.status).toBe('partial_backorder');
    expect(result.downgradedLines).toEqual([{ variantId, requested: 3, fulfilled: 2 }]);
    const created = orderModel.create.mock.calls[0][0];
    expect(created.status).toBe('open');
    expect(created.autoBackorderedAt).toBeInstanceOf(Date);
    expect(created.lines).toEqual([
      expect.objectContaining({ quantity: 2, isOrder: false }),
      expect.objectContaining({ quantity: 1, isOrder: true }),
    ]);
  });

  it('fires a best-effort staff alert (email + log) when a sale is auto-downgraded into a partial backorder', async () => {
    products.reserveForOfflineSale.mockResolvedValue(2);

    await service.syncBatch(tenantId, locationId, [baseSale(3)]);

    expect(notifications.sendStaffEmail).toHaveBeenCalledTimes(1);
    const [subject, text] = notifications.sendStaffEmail.mock.calls[0];
    expect(subject).toContain('11'); // order number from counters.next mock
    expect(text).toContain(variantId);
    expect(notifications.logStaffAlert).toHaveBeenCalledWith(
      'offline_sale_auto_backordered',
      expect.objectContaining({
        orderNumber: 11,
        clientSaleId: 'client-sale-1',
        downgradedLines: [{ variantId, requested: 3, fulfilled: 2 }],
      }),
    );
  });

  it('does not let a staff-email failure break the sync response (best-effort only)', async () => {
    products.reserveForOfflineSale.mockResolvedValue(2);
    notifications.sendStaffEmail.mockRejectedValueOnce(new Error('smtp down'));

    const [result] = await service.syncBatch(tenantId, locationId, [baseSale(3)]);

    expect(result.status).toBe('partial_backorder');
    expect(notifications.logStaffAlert).toHaveBeenCalled();
  });

  it('AC: a sale with zero stock available still creates the order, entirely as a backorder', async () => {
    products.reserveForOfflineSale.mockResolvedValue(0);

    const [result] = await service.syncBatch(tenantId, locationId, [baseSale(3)]);

    expect(result.status).toBe('partial_backorder');
    const created = orderModel.create.mock.calls[0][0];
    expect(created.status).toBe('open');
    expect(created.lines).toEqual([expect.objectContaining({ quantity: 3, isOrder: true })]);
  });

  it('never calls reserveForOfflineSale for a line the PDV already marked as an explicit encomenda', async () => {
    await service.syncBatch(tenantId, locationId, [
      baseSale(3, { lines: [{ variantId, quantity: 3, unitPrice: 20, productionPrice: 0, isOrder: true }] }),
    ]);

    expect(products.reserveForOfflineSale).not.toHaveBeenCalled();
    const created = orderModel.create.mock.calls[0][0];
    expect(created.status).toBe('open');
  });

  it('processes multiple sales in the same batch independently', async () => {
    products.reserveForOfflineSale.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    counters.next.mockResolvedValueOnce(11).mockResolvedValueOnce(12);

    const results = await service.syncBatch(tenantId, locationId, [
      baseSale(3, { clientSaleId: 'sale-a' }),
      baseSale(1, { clientSaleId: 'sale-b' }),
    ]);

    expect(results.map((r) => r.clientSaleId)).toEqual(['sale-a', 'sale-b']);
    expect(orderModel.create).toHaveBeenCalledTimes(2);
  });

  it('on a duplicate-clientSaleId race (concurrent replay), reverses this attempt\'s reservation and reports the winning order', async () => {
    products.reserveForOfflineSale.mockResolvedValue(3);
    const winner = { _id: new Types.ObjectId(), number: 9, clientSaleId: 'client-sale-1', autoBackorderedAt: undefined };
    orderModel.create.mockRejectedValueOnce(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
    orderModel.findOne.mockReturnValueOnce(chain(null)).mockReturnValueOnce(chain(winner));

    const [result] = await service.syncBatch(tenantId, locationId, [baseSale(3)]);

    expect(result).toEqual({
      clientSaleId: 'client-sale-1',
      orderId: String(winner._id),
      orderNumber: 9,
      status: 'ok',
    });
    expect(products.applySaleReversalForOrderVariant).toHaveBeenCalledWith(
      expect.any(Types.ObjectId),
      variantId,
      undefined,
      tenantId,
      locationId,
    );
  });
});

// Regression (caught live, not by the mocked unit tests above): a syncBatch order that ends
// up 'open' because one line became a backorder still has REAL stock already deducted for
// its other line(s) at sync time. `remove()`/`update()` used to gate all stock-reversal
// logic purely on `isStockAppliedStatus(status)`, which is false for 'open' — so deleting
// (or cancelling) a partially-backordered synced order silently left its stock deducted
// forever. Fixed by also treating any order with a `clientSaleId` as stock-applied.
describe('OrdersService — synced (clientSaleId) orders always reverse their applied stock, even when status is "open"', () => {
  let service: OrdersService;
  const tenantId = new Types.ObjectId().toString();
  const customerId = new Types.ObjectId();
  const variantId = new Types.ObjectId();
  const locationId = new Types.ObjectId().toString();

  const orderModel: any = { findOne: jest.fn() };
  const variantModel: any = { find: jest.fn() };
  const products = {
    applySaleReversalsForOrder: jest.fn().mockResolvedValue(undefined),
    applySaleDeductionsForOrder: jest.fn().mockResolvedValue(undefined),
  };
  const payments = { cancelPendingForOrder: jest.fn(), syncPaymentPaidForOrder: jest.fn() };
  const loyalty = { creditForOrder: jest.fn() };
  const counters = { next: jest.fn().mockResolvedValue(1) };

  function syncedOrderDoc(overrides: Record<string, unknown> = {}) {
    const doc: any = {
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(tenantId),
      customerId,
      number: 20,
      channel: 'in_person',
      status: 'open',
      clientSaleId: 'client-sale-remove-test',
      locationId: new Types.ObjectId(locationId),
      lines: [
        { variantId, quantity: 2, unitPrice: 20, isOrder: false },
        { variantId, quantity: 1, unitPrice: 20, isOrder: true },
      ],
      total: 60,
      deleteOne: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue(undefined),
      toObject() {
        return { ...doc };
      },
      ...overrides,
    };
    return doc;
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    payments.cancelPendingForOrder.mockResolvedValue(undefined);
    variantModel.find.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue([]) }) });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: getModelToken(ProductVariant.name), useValue: variantModel },
        { provide: ExcelSpreadsheetService, useValue: {} },
        { provide: ProductsService, useValue: products },
        { provide: PurchasesService, useValue: { sumPendingOutstandingByVariantIds: jest.fn().mockResolvedValue(new Map()) } },
        { provide: LoyaltyService, useValue: loyalty },
        { provide: PromotionsService, useValue: {} },
        { provide: PaymentsService, useValue: payments },
        { provide: getModelToken(Payment.name), useValue: {} },
        { provide: getModelToken(Customer.name), useValue: {} },
        { provide: NotificationsService, useValue: { sendEmail: jest.fn() } },
        { provide: CountersService, useValue: counters },
      ],
    }).compile();
    service = module.get<OrdersService>(OrdersService);
  });

  it('remove(): reverses stock for the non-backorder line of a synced "open" order', async () => {
    const doc = syncedOrderDoc();
    orderModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

    await service.remove(tenantId, String(doc._id));

    expect(products.applySaleReversalsForOrder).toHaveBeenCalledWith(
      doc._id,
      [{ variantId }],
      undefined,
      tenantId,
      locationId,
    );
    expect(doc.deleteOne).toHaveBeenCalled();
  });

  it('remove(): never touches stock for a plain "open" draft with no clientSaleId (unrelated regression guard)', async () => {
    const doc = syncedOrderDoc({ clientSaleId: undefined });
    orderModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

    await service.remove(tenantId, String(doc._id));

    expect(products.applySaleReversalsForOrder).not.toHaveBeenCalled();
  });

  it('update(): reverses stock when cancelling a synced "open" order', async () => {
    const doc = syncedOrderDoc();
    orderModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

    await service.update(tenantId, String(doc._id), { status: 'cancelled' } as any);

    expect(products.applySaleReversalsForOrder).toHaveBeenCalledWith(
      doc._id,
      expect.arrayContaining([{ variantId }]),
      undefined,
      tenantId,
      locationId,
    );
  });
});
