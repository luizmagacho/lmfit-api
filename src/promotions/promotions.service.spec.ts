import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { Promotion } from './schemas/promotion.schema';

describe('PromotionsService.redeem', () => {
  let service: PromotionsService;
  const model = { findOneAndUpdate: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromotionsService,
        { provide: getModelToken(Promotion.name), useValue: model },
      ],
    }).compile();
    service = module.get<PromotionsService>(PromotionsService);
  });

  // Regression: an earlier version filtered `maxUses: { $eq: null }` to detect
  // "no limit", which rejected coupons that simply never had maxUses set (undefined
  // is not null in Mongo) — an unlimited coupon could never be redeemed. The fix
  // needs a filter that also matches "field absent".
  it('builds an $or guard that accepts a coupon with no usage cap set', async () => {
    model.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: '1' }) });

    await service.redeem('507f1f77bcf86cd799439011', 'BEMVINDO10');

    const filter = model.findOneAndUpdate.mock.calls[0][0];
    expect(filter.$or).toEqual(
      expect.arrayContaining([
        { maxUses: { $exists: false } },
        { maxUses: null },
        { $expr: { $lt: ['$usedCount', '$maxUses'] } },
      ]),
    );
  });

  it('throws when the atomic update finds no matching document (limit hit or inactive)', async () => {
    model.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.redeem('507f1f77bcf86cd799439011', 'ESGOTADO')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('normalizes the code to uppercase/trimmed before querying', async () => {
    model.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: '1' }) });
    await service.redeem('507f1f77bcf86cd799439011', '  bemvindo10  ');
    const filter = model.findOneAndUpdate.mock.calls[0][0];
    expect(filter.code).toBe('BEMVINDO10');
  });
});
