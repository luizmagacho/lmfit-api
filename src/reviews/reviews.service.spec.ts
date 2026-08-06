import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ReviewsService } from './reviews.service';

function chain<T>(value: T) {
  const c: any = { exec: jest.fn().mockResolvedValue(value) };
  c.lean = () => c;
  c.select = () => c;
  c.populate = () => c;
  c.sort = () => c;
  c.skip = () => c;
  c.limit = () => c;
  return c;
}

describe('ReviewsService', () => {
  const tenantId = new Types.ObjectId().toString();
  const customerId = new Types.ObjectId().toString();
  const productId = new Types.ObjectId().toString();
  const model: any = {
    findOne: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
    findOneAndUpdate: jest.fn(),
    aggregate: jest.fn(),
  };
  const orderModel: any = { findOne: jest.fn() };
  const variantModel: any = { find: jest.fn() };

  const service = new ReviewsService(model, orderModel, variantModel);

  beforeEach(() => jest.clearAllMocks());

  describe('createFromCustomer — verified-purchase gate', () => {
    it('rejects a second review from the same customer for the same product', async () => {
      model.findOne.mockReturnValue(chain({ _id: 'existing' }));

      await expect(
        service.createFromCustomer(tenantId, customerId, { productId, rating: 5 }),
      ).rejects.toThrow(BadRequestException);
      expect(orderModel.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the product has no variants at all', async () => {
      model.findOne.mockReturnValue(chain(null));
      variantModel.find.mockReturnValue(chain([]));

      await expect(
        service.createFromCustomer(tenantId, customerId, { productId, rating: 4 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when no shipped/completed order contains one of the product\'s variants', async () => {
      model.findOne.mockReturnValue(chain(null));
      variantModel.find.mockReturnValue(chain([{ _id: new Types.ObjectId() }]));
      orderModel.findOne.mockReturnValue(chain(null));

      await expect(
        service.createFromCustomer(tenantId, customerId, { productId, rating: 3, comment: 'ok' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates the review tied to the qualifying order once purchase is verified', async () => {
      const variantId = new Types.ObjectId();
      const orderId = new Types.ObjectId();
      model.findOne.mockReturnValue(chain(null));
      variantModel.find.mockReturnValue(chain([{ _id: variantId }]));
      orderModel.findOne.mockReturnValue(chain({ _id: orderId }));
      model.create.mockResolvedValue({ _id: new Types.ObjectId(), rating: 5 });

      await service.createFromCustomer(tenantId, customerId, {
        productId,
        rating: 5,
        comment: 'Adorei!',
      });

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId,
          rating: 5,
          comment: 'Adorei!',
        }),
      );
      const orderQuery = orderModel.findOne.mock.calls[0][0];
      expect(orderQuery.status.$in).toEqual(['shipped', 'completed']);
      expect(orderQuery['lines.variantId'].$in).toEqual([variantId]);
    });
  });

  describe('listApprovedForProduct', () => {
    it('returns empty stats without querying for an invalid productId', async () => {
      const result = await service.listApprovedForProduct(tenantId, 'not-an-id');
      expect(result).toEqual({ items: [], average: 0, count: 0 });
      expect(model.find).not.toHaveBeenCalled();
    });

    it('computes average/count from the aggregate and only includes approved reviews in the match', async () => {
      model.find.mockReturnValue(
        chain([
          {
            _id: new Types.ObjectId(),
            rating: 5,
            comment: 'Ótimo',
            createdAt: new Date(),
            customerId: { name: 'Ana' },
          },
        ]),
      );
      model.aggregate.mockResolvedValue([{ average: 4.5, count: 2 }]);

      const result = await service.listApprovedForProduct(tenantId, productId);

      expect(result.average).toBe(4.5);
      expect(result.count).toBe(2);
      expect(result.items[0]).toMatchObject({ rating: 5, comment: 'Ótimo', customerName: 'Ana' });
      const findMatch = model.find.mock.calls[0][0];
      expect(findMatch.status).toBe('approved');
    });

    it('falls back to "Cliente" when the populated customer has no name', async () => {
      model.find.mockReturnValue(
        chain([{ _id: new Types.ObjectId(), rating: 4, createdAt: new Date(), customerId: {} }]),
      );
      model.aggregate.mockResolvedValue([]);

      const result = await service.listApprovedForProduct(tenantId, productId);

      expect(result.items[0].customerName).toBe('Cliente');
      expect(result.average).toBe(0);
      expect(result.count).toBe(0);
    });
  });

  describe('approve / reject', () => {
    it('approve() sets status/reviewedBy/reviewedAt', async () => {
      model.findOneAndUpdate.mockReturnValue(chain({ _id: 'r1', status: 'approved' }));
      const userId = new Types.ObjectId().toString();

      await service.approve(tenantId, new Types.ObjectId().toString(), userId);

      const [, update] = model.findOneAndUpdate.mock.calls[0];
      expect(update.$set.status).toBe('approved');
      expect(update.$set.reviewedAt).toBeInstanceOf(Date);
    });

    it('approve() throws NotFoundException when the review does not exist', async () => {
      model.findOneAndUpdate.mockReturnValue(chain(null));
      const userId = new Types.ObjectId().toString();

      await expect(service.approve(tenantId, new Types.ObjectId().toString(), userId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('reject() sets status/rejectionNote', async () => {
      model.findOneAndUpdate.mockReturnValue(chain({ _id: 'r1', status: 'rejected' }));
      const userId = new Types.ObjectId().toString();

      await service.reject(tenantId, new Types.ObjectId().toString(), userId, 'sem detalhe suficiente');

      const [, update] = model.findOneAndUpdate.mock.calls[0];
      expect(update.$set.status).toBe('rejected');
      expect(update.$set.rejectionNote).toBe('sem detalhe suficiente');
    });
  });
});
