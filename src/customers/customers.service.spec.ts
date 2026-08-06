import { Types } from 'mongoose';
import { CustomersService } from './customers.service';

function chain<T>(value: T) {
  const c: any = { exec: jest.fn().mockResolvedValue(value) };
  c.lean = () => c;
  c.select = () => c;
  return c;
}

describe('CustomersService — e-mail lookup/dedup (Loop 7)', () => {
  const tenantId = new Types.ObjectId().toString();
  const model: any = { findOne: jest.fn(), create: jest.fn() };
  const excel: any = {};
  const service = new CustomersService(model, excel);

  beforeEach(() => jest.clearAllMocks());

  it('findByEmail normalizes case/whitespace before querying', async () => {
    model.findOne.mockReturnValue(chain({ _id: 'c1', email: 'ana@x.com' }));
    await service.findByEmail(tenantId, '  ANA@X.com ');
    expect(model.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ana@x.com' }),
    );
  });

  it('findOrCreateByEmail returns the existing customer without creating a new one', async () => {
    model.findOne.mockReturnValue(chain({ _id: 'c1', email: 'ana@x.com' }));
    const out = await service.findOrCreateByEmail(tenantId, 'ana@x.com');
    expect(out).toEqual({ _id: 'c1', email: 'ana@x.com' });
    expect(model.create).not.toHaveBeenCalled();
  });

  it('findOrCreateByEmail creates a minimal customer (name falls back to the e-mail local part) when none exists', async () => {
    model.findOne.mockReturnValue(chain(null));
    model.create.mockResolvedValue({ _id: 'c2', name: 'ana', email: 'ana@x.com' });
    const out = await service.findOrCreateByEmail(tenantId, 'ana@x.com');
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ana', email: 'ana@x.com' }),
    );
    expect(out).toEqual({ _id: 'c2', name: 'ana', email: 'ana@x.com' });
  });

  it('findOrCreateByEmail uses the provided name over the e-mail fallback', async () => {
    model.findOne.mockReturnValue(chain(null));
    model.create.mockResolvedValue({ _id: 'c3' });
    await service.findOrCreateByEmail(tenantId, 'ana@x.com', 'Ana Souza');
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ana Souza' }),
    );
  });
});

describe('CustomersService.applyStoreCredit (Loop 9)', () => {
  const tenantId = new Types.ObjectId().toString();
  const customerId = new Types.ObjectId().toString();
  const model: any = { findOne: jest.fn(), findOneAndUpdate: jest.fn() };
  const excel: any = {};
  const service = new CustomersService(model, excel);

  beforeEach(() => jest.clearAllMocks());

  it('caps the deduction at the customer\'s real balance, not the requested max', async () => {
    model.findOne.mockReturnValue(chain({ storeCreditBalance: 30 }));
    model.findOneAndUpdate.mockReturnValue(chain({ _id: customerId }));
    const applied = await service.applyStoreCredit(tenantId, customerId, 100);
    expect(applied).toBe(30);
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ storeCreditBalance: { $gte: 30 } }),
      { $inc: { storeCreditBalance: -30 } },
    );
  });

  it('caps the deduction at the requested max when the balance is larger', async () => {
    model.findOne.mockReturnValue(chain({ storeCreditBalance: 500 }));
    model.findOneAndUpdate.mockReturnValue(chain({ _id: customerId }));
    const applied = await service.applyStoreCredit(tenantId, customerId, 42.5);
    expect(applied).toBe(42.5);
  });

  it('returns 0 without writing anything when maxAmount is 0 or negative', async () => {
    const applied = await service.applyStoreCredit(tenantId, customerId, 0);
    expect(applied).toBe(0);
    expect(model.findOne).not.toHaveBeenCalled();
  });

  it('returns 0 when the customer has no balance', async () => {
    model.findOne.mockReturnValue(chain({ storeCreditBalance: 0 }));
    const applied = await service.applyStoreCredit(tenantId, customerId, 100);
    expect(applied).toBe(0);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns 0 if the atomic guard fails (balance changed concurrently between read and write)', async () => {
    model.findOne.mockReturnValue(chain({ storeCreditBalance: 30 }));
    model.findOneAndUpdate.mockReturnValue(chain(null));
    const applied = await service.applyStoreCredit(tenantId, customerId, 30);
    expect(applied).toBe(0);
  });

  it('returns 0 for an invalid customerId without querying', async () => {
    const applied = await service.applyStoreCredit(tenantId, 'not-an-id', 50);
    expect(applied).toBe(0);
    expect(model.findOne).not.toHaveBeenCalled();
  });
});

describe('CustomersService wishlist (Loop 9 continuation)', () => {
  const tenantId = new Types.ObjectId().toString();
  const customerId = new Types.ObjectId().toString();
  const productId = new Types.ObjectId().toString();
  const model: any = { findOne: jest.fn(), findOneAndUpdate: jest.fn() };
  const excel: any = {};
  const service = new CustomersService(model, excel);

  beforeEach(() => jest.clearAllMocks());

  it('getWishlistProductIds returns the stored ids as strings', async () => {
    model.findOne.mockReturnValue(chain({ wishlist: [new Types.ObjectId(productId)] }));
    const ids = await service.getWishlistProductIds(tenantId, customerId);
    expect(ids).toEqual([productId]);
  });

  it('getWishlistProductIds throws NotFoundException for an invalid customerId', async () => {
    await expect(service.getWishlistProductIds(tenantId, 'not-an-id')).rejects.toThrow();
    expect(model.findOne).not.toHaveBeenCalled();
  });

  it('getWishlistProductIds throws NotFoundException when the customer does not exist', async () => {
    model.findOne.mockReturnValue(chain(null));
    await expect(service.getWishlistProductIds(tenantId, customerId)).rejects.toThrow();
  });

  it('addToWishlist uses $addToSet so the same product is never duplicated', async () => {
    model.findOneAndUpdate.mockReturnValue(chain({ wishlist: [new Types.ObjectId(productId)] }));
    const ids = await service.addToWishlist(tenantId, customerId, productId);
    expect(ids).toEqual([productId]);
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: new Types.ObjectId(customerId) }),
      { $addToSet: { wishlist: new Types.ObjectId(productId) } },
      { new: true },
    );
  });

  it('addToWishlist throws NotFoundException for an invalid productId', async () => {
    await expect(service.addToWishlist(tenantId, customerId, 'not-an-id')).rejects.toThrow();
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('removeFromWishlist uses $pull and returns the updated ids', async () => {
    model.findOneAndUpdate.mockReturnValue(chain({ wishlist: [] }));
    const ids = await service.removeFromWishlist(tenantId, customerId, productId);
    expect(ids).toEqual([]);
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: new Types.ObjectId(customerId) }),
      { $pull: { wishlist: new Types.ObjectId(productId) } },
      { new: true },
    );
  });

  it('removeFromWishlist throws NotFoundException when the customer does not exist', async () => {
    model.findOneAndUpdate.mockReturnValue(chain(null));
    await expect(service.removeFromWishlist(tenantId, customerId, productId)).rejects.toThrow();
  });
});
