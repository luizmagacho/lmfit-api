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

describe('ProductsService — public catalog filters/sort/pagination (Loop 5)', () => {
  let service: ProductsService;
  const productModel: any = { aggregate: jest.fn(), distinct: jest.fn() };
  const variantModel = {};
  const ledgerModel = {};
  const locations = {};
  const eventEmitter = { emit: jest.fn() };
  const tenantId = new Types.ObjectId().toString();

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

  function mockAggregate(resultForItems: unknown[], resultForCount: unknown[]) {
    let call = 0;
    productModel.aggregate.mockImplementation(() => {
      call += 1;
      return { exec: jest.fn().mockResolvedValue(call === 1 ? resultForItems : resultForCount) };
    });
  }

  it('applies category as a top-level $match', async () => {
    mockAggregate([], [{ total: 0 }]);
    await service.listPublicCatalog(tenantId, { category: 'Camisas', page: 1, limit: 20 } as any);
    const pipeline = productModel.aggregate.mock.calls[0][0];
    expect(pipeline[0].$match.category).toBe('Camisas');
  });

  it('combines size+color into a single $elemMatch on the same variant, requiring stock on that same variant', async () => {
    mockAggregate([], [{ total: 0 }]);
    await service.listPublicCatalog(tenantId, { size: 'M', color: 'Preto', page: 1, limit: 20 } as any);
    const pipeline = productModel.aggregate.mock.calls[0][0];
    const variantMatchStage = pipeline.find((s: any) => s.$match?.variants?.$elemMatch);
    expect(variantMatchStage.$match.variants.$elemMatch).toEqual({
      quantityOnHand: { $gt: 0 },
      size: 'M',
      color: 'Preto',
    });
  });

  it('filters price independently of size/color via a second $elemMatch under $and, both requiring stock', async () => {
    mockAggregate([], [{ total: 0 }]);
    await service.listPublicCatalog(tenantId, {
      color: 'Preto',
      priceMin: 100,
      priceMax: 200,
      page: 1,
      limit: 20,
    } as any);
    const pipeline = productModel.aggregate.mock.calls[0][0];
    const andStage = pipeline.find((s: any) => s.$match?.$and);
    expect(andStage.$match.$and).toEqual([
      { variants: { $elemMatch: { quantityOnHand: { $gt: 0 }, color: 'Preto' } } },
      { variants: { $elemMatch: { quantityOnHand: { $gt: 0 }, price: { $gte: 100, $lte: 200 } } } },
    ]);
  });

  it('requires at least one in-stock variant even with no color/size/price filter at all', async () => {
    mockAggregate([], [{ total: 0 }]);
    await service.listPublicCatalog(tenantId, { page: 1, limit: 20 } as any);
    const pipeline = productModel.aggregate.mock.calls[0][0];
    const variantMatchStage = pipeline.find((s: any) => s.$match?.variants?.$elemMatch);
    expect(variantMatchStage.$match.variants.$elemMatch).toEqual({ quantityOnHand: { $gt: 0 } });
  });

  it('strips out-of-stock variants from the returned product via a $filter stage, before computing minVariantPrice', async () => {
    mockAggregate([], [{ total: 0 }]);
    await service.listPublicCatalog(tenantId, { page: 1, limit: 20 } as any);
    const pipeline = productModel.aggregate.mock.calls[0][0];
    const filterStageIndex = pipeline.findIndex((s: any) => s.$set?.variants?.$filter);
    const priceStageIndex = pipeline.findIndex((s: any) => s.$addFields?.minVariantPrice);
    expect(filterStageIndex).toBeGreaterThanOrEqual(0);
    expect(priceStageIndex).toBeGreaterThan(filterStageIndex);
    expect(pipeline[filterStageIndex].$set.variants.$filter).toEqual({
      input: '$variants',
      as: 'v',
      cond: { $gt: ['$$v.quantityOnHand', 0] },
    });
  });

  it.each([
    ['menor-preco', { minVariantPrice: 1 }],
    ['maior-preco', { minVariantPrice: -1 }],
    ['lancamentos', { createdAt: -1 }],
    ['relevancia', { name: 1 }],
    [undefined, { name: 1 }],
  ])('sort=%s produces the matching $sort stage', async (sort, expected) => {
    mockAggregate([], [{ total: 0 }]);
    await service.listPublicCatalog(tenantId, { sort, page: 1, limit: 20 } as any);
    const pipeline = productModel.aggregate.mock.calls[0][0];
    const sortStage = pipeline.find((s: any) => s.$sort);
    expect(sortStage.$sort).toEqual(expected);
  });

  it('computes $skip from page/limit and applies $limit', async () => {
    mockAggregate([], [{ total: 0 }]);
    await service.listPublicCatalog(tenantId, { page: 3, limit: 10 } as any);
    const pipeline = productModel.aggregate.mock.calls[0][0];
    const skipStage = pipeline.find((s: any) => s.$skip !== undefined);
    const limitStage = pipeline.find((s: any) => s.$limit !== undefined);
    expect(skipStage.$skip).toBe(20);
    expect(limitStage.$limit).toBe(10);
  });

  it('returns total from the separate count pipeline, not the items page length', async () => {
    mockAggregate([{ _id: '1', name: 'A', variants: [] }], [{ total: 42 }]);
    const result = await service.listPublicCatalog(tenantId, { page: 1, limit: 20 } as any);
    expect(result.total).toBe(42);
    expect(result.items).toHaveLength(1);
  });

  it('getPublicCatalogFacets aggregates distinct colors/sizes/price range independent of any filter', async () => {
    productModel.distinct.mockReturnValue({ exec: jest.fn().mockResolvedValue(['Camisas', 'Shorts']) });
    productModel.aggregate.mockReturnValue({
      exec: jest
        .fn()
        .mockResolvedValue([{ colors: ['Preto', 'Branco'], sizes: ['M', 'G'], priceMin: 50, priceMax: 300 }]),
    });
    const facets = await service.getPublicCatalogFacets(tenantId);
    expect(facets).toEqual({
      categories: ['Camisas', 'Shorts'],
      colors: ['Branco', 'Preto'],
      sizes: ['G', 'M'],
      priceMin: 50,
      priceMax: 300,
    });
  });

  describe('getPublicProductsByIds (wishlist — Loop 9 continuation)', () => {
    it('returns [] without querying when no id is a valid ObjectId', async () => {
      const items = await service.getPublicProductsByIds(tenantId, ['not-an-id', '']);
      expect(items).toEqual([]);
      expect(productModel.aggregate).not.toHaveBeenCalled();
    });

    it('filters out invalid ids and matches only active products by the valid ones', async () => {
      const id1 = new Types.ObjectId().toString();
      mockAggregate([{ _id: id1, name: 'Legging', variants: [] }], []);
      await service.getPublicProductsByIds(tenantId, [id1, 'not-an-id']);
      const pipeline = productModel.aggregate.mock.calls[0][0];
      expect(pipeline[0].$match.active).toBe(true);
      expect(pipeline[0].$match._id.$in).toEqual([new Types.ObjectId(id1)]);
    });

    it('drops ids that no longer resolve to an active product (stale wishlist entries)', async () => {
      const id1 = new Types.ObjectId().toString();
      const id2 = new Types.ObjectId().toString();
      // Only id1 comes back from the (mocked) $match on active products.
      mockAggregate([{ _id: id1, name: 'Legging', variants: [] }], []);
      const items = await service.getPublicProductsByIds(tenantId, [id1, id2]);
      expect(items).toHaveLength(1);
      expect((items[0] as any)._id).toBe(id1);
    });
  });
});

describe('ProductsService.reserveForOfflineSale — location + tenant-wide reconciled reserve (Loop PDV-OFF-4)', () => {
  let service: ProductsService;
  const variantModel = { findOneAndUpdate: jest.fn() };
  const productModel = {};
  const ledgerModel = { create: jest.fn() };
  const locations = {
    reserveUpToAvailable: jest.fn(),
    adjust: jest.fn(),
    getOrCreateDefault: jest.fn(),
  };
  const eventEmitter = { emit: jest.fn() };
  const tenantId = new Types.ObjectId().toString();
  const variantId = new Types.ObjectId().toString();
  const locationId = new Types.ObjectId().toString();
  const orderId = new Types.ObjectId();

  beforeEach(async () => {
    jest.clearAllMocks();
    ledgerModel.create.mockResolvedValue({});
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

  it('reserves the full amount when both the location and the tenant total have enough', async () => {
    locations.reserveUpToAvailable.mockResolvedValue(4);
    variantModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({ quantityOnHand: 10 }) });

    const fulfilled = await service.reserveForOfflineSale(tenantId, variantId, locationId, 4, orderId);

    expect(fulfilled).toBe(4);
    expect(locations.adjust).not.toHaveBeenCalled();
    expect(ledgerModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ delta: -4, reason: 'sale', orderId }),
    );
    // Regression: Mongoose rejects an aggregation-pipeline update unless {updatePipeline:
    // true} is passed explicitly — only surfaces against a real MongoDB, never in this mock.
    const [, , options] = variantModel.findOneAndUpdate.mock.calls[0];
    expect(options).toMatchObject({ updatePipeline: true });
  });

  it('returns 0 without touching quantityOnHand or the ledger when the location has nothing allocated', async () => {
    locations.reserveUpToAvailable.mockResolvedValue(0);

    const fulfilled = await service.reserveForOfflineSale(tenantId, variantId, locationId, 4, orderId);

    expect(fulfilled).toBe(0);
    expect(variantModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(ledgerModel.create).not.toHaveBeenCalled();
  });

  it('gives back the difference to the location when the tenant-wide total is lower (drift case)', async () => {
    locations.reserveUpToAvailable.mockResolvedValue(4);
    variantModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({ quantityOnHand: 2 }) });

    const fulfilled = await service.reserveForOfflineSale(tenantId, variantId, locationId, 4, orderId);

    expect(fulfilled).toBe(2);
    expect(locations.adjust).toHaveBeenCalledWith(tenantId, expect.anything(), 2, locationId);
    expect(ledgerModel.create).toHaveBeenCalledWith(expect.objectContaining({ delta: -2 }));
  });

  it('never writes a ledger entry when the tenant-wide total turns out to be zero', async () => {
    locations.reserveUpToAvailable.mockResolvedValue(3);
    variantModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({ quantityOnHand: 0 }) });

    const fulfilled = await service.reserveForOfflineSale(tenantId, variantId, locationId, 3, orderId);

    expect(fulfilled).toBe(0);
    expect(locations.adjust).toHaveBeenCalledWith(tenantId, expect.anything(), 3, locationId);
    expect(ledgerModel.create).not.toHaveBeenCalled();
  });

  it('resolves to the tenant default location when none is passed', async () => {
    const defaultLocId = new Types.ObjectId();
    locations.getOrCreateDefault.mockResolvedValue({ _id: defaultLocId });
    locations.reserveUpToAvailable.mockResolvedValue(1);
    variantModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({ quantityOnHand: 5 }) });

    await service.reserveForOfflineSale(tenantId, variantId, undefined, 1, orderId);

    expect(locations.reserveUpToAvailable).toHaveBeenCalledWith(
      tenantId,
      expect.anything(),
      String(defaultLocId),
      1,
    );
  });

  it('is a no-op for a zero or negative requested quantity', async () => {
    expect(await service.reserveForOfflineSale(tenantId, variantId, locationId, 0, orderId)).toBe(0);
    expect(locations.reserveUpToAvailable).not.toHaveBeenCalled();
  });
});

// Regression: initial stock entered on a new product (or edited on an existing variant) used
// to only ever touch ProductVariant.quantityOnHand — it never became a real StockLevel row,
// so the product was invisible in "estoque por local" until someone allocated it manually.
// LocationsService.adjust() (already used elsewhere in this file for other stock-movement
// paths) must be mirrored here too, at product create/update time.
/** Chainable stand-in for a Mongoose query — every method returns another instance of the
 *  same chain, and the chain is itself an already-resolved Promise, so it satisfies whatever
 *  order of `.sort()/.lean()/.populate()/.exec()` the real call site happens to use. */
function chainableResolved<T>(data: T): any {
  const p: any = Promise.resolve(data);
  p.lean = () => chainableResolved(data);
  p.sort = () => chainableResolved(data);
  p.exec = () => Promise.resolve(data);
  p.populate = () => chainableResolved(data);
  p.select = () => chainableResolved(data);
  p.skip = () => chainableResolved(data);
  p.limit = () => chainableResolved(data);
  return p;
}

describe('ProductsService — new/edited stock is mirrored into StockLevel at the default location', () => {
  let service: ProductsService;
  const productId = new Types.ObjectId();
  const variantId = new Types.ObjectId();
  const productModel = { create: jest.fn(), findOne: jest.fn() };
  const variantModel = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
  };
  const ledgerModel = { create: jest.fn() };
  const locations = { adjust: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const tenantId = new Types.ObjectId().toString();

  beforeEach(async () => {
    jest.clearAllMocks();
    ledgerModel.create.mockResolvedValue({});
    locations.adjust.mockResolvedValue(undefined);
    // No existing variants for this product yet, and no SKU collisions.
    variantModel.find.mockReturnValue(chainableResolved([]));
    variantModel.findOne.mockReturnValue(chainableResolved(null));
    productModel.findOne.mockReturnValue(chainableResolved({ _id: productId, variants: [] }));
    productModel.create.mockResolvedValue({ _id: productId });

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

  it('mirrors a new variant\'s initial on-hand into the default location on product create', async () => {
    variantModel.create.mockResolvedValue({ _id: variantId, toObject: () => ({}) });

    await service.createProduct(tenantId, {
      name: 'Legging Preta',
      slug: 'legging-preta',
      variants: [{ sku: 'LEG-PRE-M', size: 'M', priceRetail: 89.9, quantityOnHand: 12 }],
    } as any);

    expect(locations.adjust).toHaveBeenCalledWith(tenantId, variantId, 12);
  });

  it('does not call adjust for a brand-new variant with zero initial stock', async () => {
    variantModel.create.mockResolvedValue({ _id: variantId, toObject: () => ({}) });

    await service.createProduct(tenantId, {
      name: 'Legging Preta',
      slug: 'legging-preta',
      variants: [{ sku: 'LEG-PRE-M', size: 'M', priceRetail: 89.9, quantityOnHand: 0 }],
    } as any);

    expect(locations.adjust).not.toHaveBeenCalled();
  });

  it('mirrors only the delta (not the raw new quantity) when an existing variant\'s stock is edited', async () => {
    variantModel.find.mockReturnValue(chainableResolved([{ _id: variantId, productId, quantityOnHand: 5 }]));
    variantModel.updateOne.mockReturnValue(chainableResolved({}));

    await service.updateProduct(tenantId, String(productId), {
      variants: [{ _id: String(variantId), sku: 'LEG-PRE-M', size: 'M', priceRetail: 89.9, quantityOnHand: 9 }],
    } as any);

    // 9 (new) - 5 (previous) = +4, not +9.
    expect(locations.adjust).toHaveBeenCalledWith(tenantId, variantId, 4);
  });
});
