import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ProductionService } from './production.service';
import { ProductionBatch } from './schemas/production-batch.schema';
import { ProductVariant } from '../products/schemas/product-variant.schema';
import { LocationsService } from '../locations/locations.service';

// Regression: adjustStock used to match `{ sku: doc.sku }` with no tenant scope and
// case-sensitive equality, and never touched LocationsService — a typo'd case/whitespace in
// the free-text SKU field silently produced/removed zero stock, a SKU collision across
// tenants could credit a DIFFERENT tenant's variant, and even a correct match never showed up
// in the per-location stock (only the cached ProductVariant.quantityOnHand total moved).
describe('ProductionService.adjustStock — credits the real variant, scoped to the tenant, via LocationsService', () => {
  let service: ProductionService;
  const tenantId = new Types.ObjectId().toString();
  const supplierBatchId = new Types.ObjectId().toString();
  const variantId = new Types.ObjectId();

  const productionModel: any = { create: jest.fn(), findOne: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() };
  const variantModel: any = { findOneAndUpdate: jest.fn() };
  const locations = { adjust: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    // create() looks up a previous batch with the same SKU to auto-copy inputs/costs from —
    // irrelevant to these tests, so always resolve "no previous batch found".
    productionModel.findOne.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve(null) }) });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductionService,
        { provide: getModelToken(ProductionBatch.name), useValue: productionModel },
        { provide: getModelToken(ProductVariant.name), useValue: variantModel },
        { provide: LocationsService, useValue: locations },
      ],
    }).compile();
    service = module.get<ProductionService>(ProductionService);
  });

  function mockVariantFound() {
    variantModel.findOneAndUpdate.mockReturnValue({
      lean: () => ({ exec: jest.fn().mockResolvedValue({ _id: variantId }) }),
    });
  }

  function mockVariantNotFound() {
    variantModel.findOneAndUpdate.mockReturnValue({
      lean: () => ({ exec: jest.fn().mockResolvedValue(null) }),
    });
  }

  it('create(): matches the variant case-insensitively, trimmed, and scoped to the tenant — not a raw string equals', async () => {
    mockVariantFound();
    productionModel.create.mockResolvedValue({ sku: '  crtvnt-pre  ', batchQty: 5, status: 'Pronto' });

    await service.create(tenantId, { name: 'Corta-vento', sku: '  crtvnt-pre  ', batchQty: 5, status: 'Pronto' } as any);

    const [filter, update] = variantModel.findOneAndUpdate.mock.calls[0];
    expect(filter.tenantId).toEqual(new Types.ObjectId(tenantId));
    expect(filter.sku).toBeInstanceOf(RegExp);
    expect(filter.sku.source).toBe('^crtvnt-pre$');
    expect(filter.sku.flags).toBe('i');
    expect(update.$inc.quantityOnHand).toBe(5);
  });

  it('create(): credits the matched variant into LocationsService, not just the cached total', async () => {
    mockVariantFound();
    productionModel.create.mockResolvedValue({ sku: 'CRTVNT-PRE', batchQty: 5, status: 'Concluído' });

    await service.create(tenantId, { name: 'Corta-vento', sku: 'CRTVNT-PRE', batchQty: 5, status: 'Concluído' } as any);

    expect(locations.adjust).toHaveBeenCalledWith(tenantId, variantId, 5);
  });

  it('create(): does nothing (no crash, no LocationsService call) when no variant matches the SKU', async () => {
    mockVariantNotFound();
    productionModel.create.mockResolvedValue({ sku: 'SKU-INEXISTENTE', batchQty: 5, status: 'Pronto' });

    await service.create(tenantId, { name: 'X', sku: 'SKU-INEXISTENTE', batchQty: 5, status: 'Pronto' } as any);

    expect(locations.adjust).not.toHaveBeenCalled();
  });

  it('create(): does not touch stock for a batch left in a non-stock-applying status', async () => {
    productionModel.create.mockResolvedValue({ sku: 'CRTVNT-PRE', batchQty: 5, status: 'Planejado' });

    await service.create(tenantId, { name: 'Corta-vento', sku: 'CRTVNT-PRE', batchQty: 5, status: 'Planejado' } as any);

    expect(variantModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(locations.adjust).not.toHaveBeenCalled();
  });

  it('update(): reverses the old quantity and applies the new one, both scoped to the tenant', async () => {
    productionModel.findOne.mockReturnValue({
      lean: () => ({ exec: jest.fn().mockResolvedValue({ _id: supplierBatchId, sku: 'CRTVNT-PRE', batchQty: 5, status: 'Pronto' }) }),
    });
    productionModel.findOneAndUpdate.mockReturnValue({
      lean: () => ({ exec: jest.fn().mockResolvedValue({ sku: 'CRTVNT-PRE', batchQty: 8, status: 'Pronto' }) }),
    });
    mockVariantFound();

    await service.update(tenantId, supplierBatchId, { batchQty: 8 } as any);

    expect(locations.adjust).toHaveBeenNthCalledWith(1, tenantId, variantId, -5);
    expect(locations.adjust).toHaveBeenNthCalledWith(2, tenantId, variantId, 8);
  });

  it('remove(): reverses the credited quantity for a completed batch', async () => {
    productionModel.findOne.mockReturnValue({
      lean: () => ({ exec: jest.fn().mockResolvedValue({ _id: supplierBatchId, sku: 'CRTVNT-PRE', batchQty: 5, status: 'Concluído' }) }),
    });
    productionModel.deleteOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 1 }) });
    mockVariantFound();

    await service.remove(tenantId, supplierBatchId);

    expect(locations.adjust).toHaveBeenCalledWith(tenantId, variantId, -5);
  });
});
