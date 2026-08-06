import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InfluencersService } from './influencers.service';
import { Influencer } from './schemas/influencer.schema';
import { Promotion } from '../promotions/schemas/promotion.schema';

describe('InfluencersService', () => {
  let service: InfluencersService;
  const influencerModel = {
    create: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findOneAndDelete: jest.fn(),
  };
  const promotionModel = { findOne: jest.fn() };

  const tenantId = '507f1f77bcf86cd799439011';
  const influencerId = '507f1f77bcf86cd799439022';

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InfluencersService,
        { provide: getModelToken(Influencer.name), useValue: influencerModel },
        { provide: getModelToken(Promotion.name), useValue: promotionModel },
      ],
    }).compile();
    service = module.get<InfluencersService>(InfluencersService);
  });

  describe('remove', () => {
    it('AC: refuses to delete an influencer that has a promotion with usedCount > 0 — protects report history', async () => {
      promotionModel.findOne.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: 'promo-1', usedCount: 3 }) }),
      });

      await expect(service.remove(tenantId, influencerId)).rejects.toBeInstanceOf(BadRequestException);
      expect(influencerModel.findOneAndDelete).not.toHaveBeenCalled();
    });

    it('AC: deletes normally when no linked promotion has been used', async () => {
      promotionModel.findOne.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      });
      influencerModel.findOneAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: influencerId }) });

      const result = await service.remove(tenantId, influencerId);

      expect(result).toEqual({ deleted: true });
      expect(influencerModel.findOneAndDelete).toHaveBeenCalled();
    });

    it('throws NotFoundException for an invalid id without hitting the database', async () => {
      await expect(service.remove(tenantId, 'not-an-object-id')).rejects.toBeInstanceOf(NotFoundException);
      expect(promotionModel.findOne).not.toHaveBeenCalled();
    });

    it('the used-promotion guard query is scoped to this tenant and this influencer only', async () => {
      promotionModel.findOne.mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      });
      influencerModel.findOneAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: influencerId }) });

      await service.remove(tenantId, influencerId);

      const filter = promotionModel.findOne.mock.calls[0][0];
      expect(String(filter.tenantId)).toBe(tenantId);
      expect(String(filter.influencerId)).toBe(influencerId);
      expect(filter.usedCount).toEqual({ $gt: 0 });
    });
  });

  describe('create', () => {
    it('scopes the new influencer to the tenant and records who created it', async () => {
      const userId = '507f1f77bcf86cd799439033';
      influencerModel.create.mockResolvedValue({ _id: 'new-1' });
      await service.create(tenantId, { name: 'Ana Fit' }, userId);
      const arg = influencerModel.create.mock.calls[0][0];
      expect(arg.name).toBe('Ana Fit');
      expect(String(arg.tenantId)).toBe(tenantId);
      expect(String(arg.createdBy)).toBe(userId);
    });
  });
});
