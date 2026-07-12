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

  beforeEach(async () => {
    jest.clearAllMocks();
    variantModel.find.mockReturnValue(
      chain([{ _id: variantId, sku: 'CAM-P', quantityOnHand: 100 }]),
    );
    orderModel.countDocuments.mockReturnValue(chain(0));
    purchases.sumPendingOutstandingByVariantIds.mockResolvedValue(new Map());

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
