import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ReportsService } from './reports.service';
import { Order } from '../orders/schemas/order.schema';
import { Product } from '../products/schemas/product.schema';
import { ProductVariant } from '../products/schemas/product-variant.schema';
import { Purchase } from '../purchases/schemas/purchase.schema';
import { ProductionBatch } from '../production/schemas/production-batch.schema';
import { Promotion } from '../promotions/schemas/promotion.schema';
import { Influencer } from '../influencers/schemas/influencer.schema';

describe('ReportsService.salesByInfluencer (Loop Influencer-C)', () => {
  let service: ReportsService;
  const orderModel = { aggregate: jest.fn() };
  const influencerModel = { findOne: jest.fn() };
  const noop = {};

  const tenantId = '507f1f77bcf86cd799439011';
  const range = { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: getModelToken(Product.name), useValue: noop },
        { provide: getModelToken(ProductVariant.name), useValue: noop },
        { provide: getModelToken(Purchase.name), useValue: noop },
        { provide: getModelToken(ProductionBatch.name), useValue: noop },
        { provide: getModelToken(Promotion.name), useValue: noop },
        { provide: getModelToken(Influencer.name), useValue: influencerModel },
      ],
    }).compile();
    service = module.get<ReportsService>(ReportsService);
  });

  it('AC: returns an empty items array when no order in range was attributed to an influencer, not an error', async () => {
    orderModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    const result = await service.salesByInfluencer(tenantId, range);

    expect(result.items).toEqual([]);
  });

  it('AC: resolves each grouped influencerId to its display name and rounds revenue to 2 decimals', async () => {
    const influencerId = new Types.ObjectId('507f1f77bcf86cd799439055');
    orderModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        { _id: influencerId, revenue: 299.999, units: 3, orderCount: 2 },
      ]),
    });
    influencerModel.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ name: 'Ana Fit' }) }) }),
    });

    const result = await service.salesByInfluencer(tenantId, range);

    expect(result.items).toEqual([
      { influencerId: String(influencerId), name: 'Ana Fit', revenue: 300, units: 3, orderCount: 2 },
    ]);
  });

  it('AC: falls back to a defensive placeholder name instead of crashing if the influencer document no longer exists', async () => {
    const influencerId = new Types.ObjectId('507f1f77bcf86cd799439066');
    orderModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([{ _id: influencerId, revenue: 100, units: 1, orderCount: 1 }]),
    });
    influencerModel.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }) }),
    });

    const result = await service.salesByInfluencer(tenantId, range);

    expect(result.items[0].name).toBe('(influenciador removido)');
  });

  it('AC: the $match stage only considers completed orders with a real coupon code, scoped to the tenant and range', async () => {
    orderModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    await service.salesByInfluencer(tenantId, range);

    const pipeline = orderModel.aggregate.mock.calls[0][0];
    const matchStage = pipeline[0].$match;
    expect(String(matchStage.tenantId)).toBe(tenantId);
    expect(matchStage.status).toEqual({ $in: ['completed'] });
    expect(matchStage.couponCode).toEqual({ $exists: true, $ne: null });
    expect(matchStage.createdAt).toEqual({ $gte: range.from, $lte: range.to });
  });

  it('AC: joins promotions by {tenantId, code} — not by a simple localField/foreignField, since couponCode is denormalized', async () => {
    orderModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    await service.salesByInfluencer(tenantId, range);

    const pipeline = orderModel.aggregate.mock.calls[0][0];
    const lookupStage = pipeline.find((s: any) => s.$lookup)?.$lookup;
    expect(lookupStage.from).toBe('promotions');
    expect(lookupStage.let).toEqual({ code: '$couponCode' });
  });

  it('AC: excludes plain coupons (no influencerId on the matched promotion) via an explicit $match after the $lookup', async () => {
    orderModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    await service.salesByInfluencer(tenantId, range);

    const pipeline = orderModel.aggregate.mock.calls[0][0];
    const guardMatch = pipeline.find((s: any) => s.$match?.['promo.influencerId']);
    expect(guardMatch.$match['promo.influencerId']).toEqual({ $exists: true, $ne: null });
  });

  it('AC: a coupon whose promotion was since deleted is dropped from the pipeline instead of crashing (preserveNullAndEmptyArrays: false)', async () => {
    orderModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    await service.salesByInfluencer(tenantId, range);

    const pipeline = orderModel.aggregate.mock.calls[0][0];
    const unwindPromo = pipeline.find((s: any) => s.$unwind?.path === '$promo');
    expect(unwindPromo.$unwind.preserveNullAndEmptyArrays).toBe(false);
  });

  it('respects a custom limit', async () => {
    orderModel.aggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

    await service.salesByInfluencer(tenantId, range, 3);

    const pipeline = orderModel.aggregate.mock.calls[0][0];
    const limitStage = pipeline.find((s: any) => s.$limit);
    expect(limitStage.$limit).toBe(3);
  });
});
