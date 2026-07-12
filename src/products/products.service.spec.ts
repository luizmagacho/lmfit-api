import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ProductsService } from './products.service';
import { Product } from './schemas/product.schema';
import { ProductVariant } from './schemas/product-variant.schema';
import { StockLedger } from './schemas/stock-ledger.schema';
import { ExcelSpreadsheetService } from '../common/excel/excel-spreadsheet.service';
import { LocationsService } from '../locations/locations.service';

describe('ProductsService — stock movement atomicity', () => {
  let service: ProductsService;
  const variantModel = { findOneAndUpdate: jest.fn(), findOne: jest.fn() };
  const productModel = {};
  const ledgerModel = { create: jest.fn(), aggregate: jest.fn() };
  const locations = { adjust: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const tenantId = new Types.ObjectId().toString();
  const variantId = new Types.ObjectId().toString();

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: getModelToken(Product.name), useValue: productModel },
        { provide: getModelToken(ProductVariant.name), useValue: variantModel },
        { provide: getModelToken(StockLedger.name), useValue: ledgerModel },
        { provide: ExcelSpreadsheetService, useValue: {} },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: LocationsService, useValue: locations },
      ],
    }).compile();
    service = module.get<ProductsService>(ProductsService);
  });

  it('guards a decrement with $gte so it can never oversell under concurrency', async () => {
    variantModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: variantId,
        tenantId,
        quantityOnHand: 3,
        toObject: () => ({ _id: variantId, quantityOnHand: 3 }),
      }),
    });
    ledgerModel.create.mockResolvedValue({});

    await service.applyStockMovementWithOrderMeta(tenantId, variantId, { delta: -5, reason: 'sale' as any });

    const [filter, update] = variantModel.findOneAndUpdate.mock.calls[0];
    expect(filter.quantityOnHand).toEqual({ $gte: 5 });
    expect(update.$inc.quantityOnHand).toBe(-5);
  });

  it('does not guard an increment (returns/restocks are never blocked)', async () => {
    variantModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: variantId,
        tenantId,
        quantityOnHand: 8,
        toObject: () => ({ _id: variantId, quantityOnHand: 8 }),
      }),
    });
    ledgerModel.create.mockResolvedValue({});

    await service.applyStockMovementWithOrderMeta(tenantId, variantId, { delta: 5, reason: 'return' as any });

    const [filter] = variantModel.findOneAndUpdate.mock.calls[0];
    expect(filter.quantityOnHand).toBeUndefined();
  });

  it('rejects a decrement that would take stock negative, instead of clamping', async () => {
    // Lost the atomic race: guard didn't match, but the variant does exist.
    variantModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    variantModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: variantId }) });

    await expect(
      service.applyStockMovementWithOrderMeta(tenantId, variantId, { delta: -1, reason: 'sale' as any }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ledgerModel.create).not.toHaveBeenCalled();
  });

  it('throws NotFoundException (not a stock error) when the variant truly does not exist', async () => {
    variantModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    variantModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

    await expect(
      service.applyStockMovementWithOrderMeta(tenantId, variantId, { delta: -1, reason: 'sale' as any }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // Regression: `getNetOrderStockDelta` used to only sum 'sale'/'sale_reversal' ledger
  // entries. When the returns module started writing 'return' entries against the same
  // order+variant, cancelling/deleting an already-returned order would compute a net
  // that ignored the return and reverse the stock a second time. 'return' must be
  // included in the aggregation filter.
  it('includes sale, sale_reversal AND return reasons when netting an order+variant', async () => {
    ledgerModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([{ total: -2 }]) });
    const orderId = new Types.ObjectId();
    const vid = new Types.ObjectId();

    await service.getNetOrderStockDelta(orderId, vid, tenantId);

    const pipeline = ledgerModel.aggregate.mock.calls[0][0];
    const matchStage = pipeline[0].$match;
    expect(matchStage.reason.$in).toEqual(expect.arrayContaining(['sale', 'sale_reversal', 'return']));
  });
});
