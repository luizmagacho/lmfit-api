import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { Promotion } from './schemas/promotion.schema';

describe('PromotionsService.redeem', () => {
  let service: PromotionsService;
  const model = {
    findOneAndUpdate: jest.fn(),
    findOne: jest.fn(),
    findOneAndDelete: jest.fn(),
    create: jest.fn(),
  };

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

describe('PromotionsService — influencer attribution (Loop Influencer-B)', () => {
  let service: PromotionsService;
  const model = {
    findOneAndUpdate: jest.fn(),
    findOne: jest.fn(),
    findOneAndDelete: jest.fn(),
    create: jest.fn(),
  };

  const tenantId = '507f1f77bcf86cd799439011';
  const promoId = '507f1f77bcf86cd799439044';
  const influencerId = '507f1f77bcf86cd799439055';

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

  describe('remove', () => {
    it('AC: refuses to delete a coupon that already has usedCount > 0', async () => {
      model.findOne.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: promoId, usedCount: 2 }) }),
      });

      await expect(service.remove(tenantId, promoId)).rejects.toBeInstanceOf(BadRequestException);
      expect(model.findOneAndDelete).not.toHaveBeenCalled();
    });

    it('AC: deletes normally when the coupon has never been used', async () => {
      model.findOne.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: promoId, usedCount: 0 }) }),
      });
      model.findOneAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: promoId }) });

      const result = await service.remove(tenantId, promoId);

      expect(result).toEqual({ deleted: true });
    });
  });

  describe('create — influencerId', () => {
    it('casts a real influencerId string to ObjectId', async () => {
      model.findOne.mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }) });
      model.create.mockResolvedValue({ _id: 'new' });

      await service.create(tenantId, {
        code: 'INFLU10',
        type: 'percent',
        value: 10,
        influencerId,
      } as any);

      const arg = model.create.mock.calls[0][0];
      expect(String(arg.influencerId)).toBe(influencerId);
    });

    it('AC: an empty influencerId string saves as undefined, never as an invalid ObjectId cast', async () => {
      model.findOne.mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }) });
      model.create.mockResolvedValue({ _id: 'new' });

      await service.create(tenantId, {
        code: 'PLAIN10',
        type: 'percent',
        value: 10,
        influencerId: '',
      } as any);

      const arg = model.create.mock.calls[0][0];
      expect(arg.influencerId).toBeUndefined();
    });
  });

  describe('update — influencerId', () => {
    it('AC: clearing influencerId ($set to undefined does not unset in Mongo) uses $unset instead', async () => {
      model.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: promoId }) });

      await service.update(tenantId, promoId, { influencerId: '' } as any);

      const updateOps = model.findOneAndUpdate.mock.calls[0][1];
      expect(updateOps.$unset).toEqual({ influencerId: '' });
      expect(updateOps.$set.influencerId).toBeUndefined();
    });

    it('sets a real influencerId via $set, cast to ObjectId', async () => {
      model.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: promoId }) });

      await service.update(tenantId, promoId, { influencerId } as any);

      const updateOps = model.findOneAndUpdate.mock.calls[0][1];
      expect(String(updateOps.$set.influencerId)).toBe(influencerId);
      expect(updateOps.$unset).toBeUndefined();
    });
  });
});
