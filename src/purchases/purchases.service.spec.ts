import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { PurchasesService } from './purchases.service';
import { Purchase } from './schemas/purchase.schema';
import { ProductVariant } from '../products/schemas/product-variant.schema';
import { Material } from '../materials/schemas/material.schema';
import { ExcelSpreadsheetService } from '../common/excel/excel-spreadsheet.service';
import { LocationsService } from '../locations/locations.service';
import { ProductsService } from '../products/products.service';

function chain<T>(value: T) {
  const c: any = { exec: jest.fn().mockResolvedValue(value) };
  c.lean = () => c;
  return c;
}

describe('PurchasesService — new-variant lines feed the normal stock-credit path', () => {
  let service: PurchasesService;
  const tenantId = new Types.ObjectId().toString();
  const productId = new Types.ObjectId().toString();
  const supplierId = new Types.ObjectId().toString();
  const newVariantId = new Types.ObjectId();

  const purchaseModel: any = { create: jest.fn(), findOne: jest.fn() };
  const variantModel: any = { updateOne: jest.fn() };
  const materialModel: any = { updateOne: jest.fn() };
  const locations = { adjust: jest.fn() };
  const products = { createVariant: jest.fn(), findOrCreateProductByName: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    variantModel.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });
    products.createVariant.mockResolvedValue({ _id: newVariantId });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchasesService,
        { provide: getModelToken(Purchase.name), useValue: purchaseModel },
        { provide: getModelToken(ProductVariant.name), useValue: variantModel },
        { provide: getModelToken(Material.name), useValue: materialModel },
        { provide: ExcelSpreadsheetService, useValue: {} },
        { provide: LocationsService, useValue: locations },
        { provide: ProductsService, useValue: products },
      ],
    }).compile();
    service = module.get<PurchasesService>(PurchasesService);
  });

  it('creates the ProductVariant for a newVariant line and stores its id, not a dangling rawName', async () => {
    purchaseModel.create.mockResolvedValue({
      status: 'pending',
      lines: [{ variantId: newVariantId, quantityReceived: 0 }],
    });

    await service.create(tenantId, {
      supplierId,
      lines: [
        {
          newVariant: { productId, sku: 'CAM-AZ-M', color: 'Azul', size: 'M' },
          quantityOrdered: 10,
        } as any,
      ],
    } as any);

    expect(products.createVariant).toHaveBeenCalledWith(
      tenantId,
      productId,
      expect.objectContaining({ sku: 'CAM-AZ-M', color: 'Azul', size: 'M' }),
    );
    const createCall = purchaseModel.create.mock.calls[0][0];
    expect(String(createCall.lines[0].variantId)).toBe(String(newVariantId));
    expect(createCall.lines[0].rawName).toBeUndefined();
  });

  it('credits stock for a newVariant line once the purchase is completed, same as any other variant line', async () => {
    purchaseModel.create.mockResolvedValue({
      tenantId,
      status: 'completed',
      lines: [{ variantId: newVariantId, quantityReceived: 10, quantityOrdered: 10 }],
    });

    await service.create(tenantId, {
      supplierId,
      status: 'completed',
      lines: [
        {
          newVariant: { productId, sku: 'CAM-AZ-M', color: 'Azul', size: 'M' },
          quantityOrdered: 10,
          quantityReceived: 10,
        } as any,
      ],
    } as any);

    expect(variantModel.updateOne).toHaveBeenCalledWith(
      { _id: newVariantId },
      { $inc: { quantityOnHand: 10 } },
    );
    expect(locations.adjust).toHaveBeenCalledWith(tenantId, newVariantId, 10);
  });

  // Regression: the "gerar N linhas" bulk color/size UI sends one purchase line per
  // combination, all sharing the same newProductName ("Conjunto Novo") when the product
  // doesn't exist yet — each line must attach to the SAME newly-created product, not spawn
  // a duplicate product per line.
  it('creates a brand-new product only once when multiple lines share newProductName', async () => {
    const newProductId = new Types.ObjectId().toString();
    products.findOrCreateProductByName.mockResolvedValue({ _id: newProductId });
    products.createVariant.mockResolvedValue({ _id: new Types.ObjectId() });
    purchaseModel.create.mockResolvedValue({ status: 'pending', lines: [] });

    await service.create(tenantId, {
      supplierId,
      lines: [
        { newVariant: { newProductName: 'Conjunto Novo', sku: 'CN-PT-G', color: 'Preto', size: 'G' }, quantityOrdered: 5 },
        { newVariant: { newProductName: 'Conjunto Novo', sku: 'CN-PT-GG', color: 'Preto', size: 'GG' }, quantityOrdered: 3 },
        { newVariant: { newProductName: '  conjunto novo  ', sku: 'CN-PT-P', color: 'Preto', size: 'P' }, quantityOrdered: 2 },
      ] as any,
    } as any);

    expect(products.findOrCreateProductByName).toHaveBeenCalledTimes(1);
    expect(products.createVariant).toHaveBeenCalledTimes(3);
    for (const call of products.createVariant.mock.calls) {
      expect(call[1]).toBe(newProductId);
    }
  });
});

// Regression: leaving "Qtd recebida" blank (its placeholder just says "Opcional") defaulted it
// to 0 even when the purchase was marked Finalizada — adjustStock credits `quantityReceived`,
// not `quantityOrdered`, so a merchant who only filled the ordered quantity saw the purchase
// save fine but stock never moved. A completed purchase should assume "received in full"
// unless a lower number was explicitly typed (partial receipt).
describe('PurchasesService — quantityReceived defaults to quantityOrdered once the purchase is completed', () => {
  let service: PurchasesService;
  const tenantId = new Types.ObjectId().toString();
  const supplierId = new Types.ObjectId().toString();
  const variantId = new Types.ObjectId();
  const purchaseId = new Types.ObjectId().toString();

  const purchaseModel: any = { create: jest.fn(), findOne: jest.fn(), findOneAndUpdate: jest.fn() };
  const variantModel: any = { updateOne: jest.fn() };
  const materialModel: any = {};
  const locations = { adjust: jest.fn() };
  const products = {};

  beforeEach(async () => {
    jest.clearAllMocks();
    variantModel.updateOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchasesService,
        { provide: getModelToken(Purchase.name), useValue: purchaseModel },
        { provide: getModelToken(ProductVariant.name), useValue: variantModel },
        { provide: getModelToken(Material.name), useValue: materialModel },
        { provide: ExcelSpreadsheetService, useValue: {} },
        { provide: LocationsService, useValue: locations },
        { provide: ProductsService, useValue: products },
      ],
    }).compile();
    service = module.get<PurchasesService>(PurchasesService);
  });

  it('create(): defaults an omitted quantityReceived to quantityOrdered when status is completed', async () => {
    purchaseModel.create.mockResolvedValue({ status: 'completed', lines: [] });

    await service.create(tenantId, {
      supplierId,
      status: 'completed',
      lines: [{ variantId: String(variantId), quantityOrdered: 8 } as any],
    } as any);

    const createCall = purchaseModel.create.mock.calls[0][0];
    expect(createCall.lines[0].quantityReceived).toBe(8);
  });

  it('create(): leaves quantityReceived at 0 when the purchase stays pending (outstanding-qty tracking must stay correct)', async () => {
    purchaseModel.create.mockResolvedValue({ status: 'pending', lines: [] });

    await service.create(tenantId, {
      supplierId,
      lines: [{ variantId: String(variantId), quantityOrdered: 8 } as any],
    } as any);

    const createCall = purchaseModel.create.mock.calls[0][0];
    expect(createCall.lines[0].quantityReceived).toBe(0);
  });

  it('create(): respects an explicit partial quantityReceived even when completed', async () => {
    purchaseModel.create.mockResolvedValue({ status: 'completed', lines: [] });

    await service.create(tenantId, {
      supplierId,
      status: 'completed',
      lines: [{ variantId: String(variantId), quantityOrdered: 8, quantityReceived: 3 } as any],
    } as any);

    const createCall = purchaseModel.create.mock.calls[0][0];
    expect(createCall.lines[0].quantityReceived).toBe(3);
  });

  it('update(): defaults quantityReceived to quantityOrdered when this same call flips status to completed', async () => {
    purchaseModel.findOne.mockReturnValue({
      lean: () => ({ exec: jest.fn().mockResolvedValue({ status: 'pending', lines: [] }) }),
    });
    purchaseModel.findOneAndUpdate.mockReturnValue({
      lean: () => ({ exec: jest.fn().mockResolvedValue({ status: 'completed', lines: [] }) }),
    });

    await service.update(tenantId, purchaseId, {
      status: 'completed',
      lines: [{ variantId: String(variantId), quantityOrdered: 8 } as any],
    } as any);

    const updateCall = purchaseModel.findOneAndUpdate.mock.calls[0][1];
    expect(updateCall.lines[0].quantityReceived).toBe(8);
  });

  it('update(): defaults quantityReceived to quantityOrdered when the purchase was ALREADY completed and only lines are being resaved', async () => {
    purchaseModel.findOne.mockReturnValue({
      lean: () => ({ exec: jest.fn().mockResolvedValue({ status: 'completed', lines: [] }) }),
    });
    purchaseModel.findOneAndUpdate.mockReturnValue({
      lean: () => ({ exec: jest.fn().mockResolvedValue({ status: 'completed', lines: [] }) }),
    });

    await service.update(tenantId, purchaseId, {
      lines: [{ variantId: String(variantId), quantityOrdered: 8 } as any],
    } as any);

    const updateCall = purchaseModel.findOneAndUpdate.mock.calls[0][1];
    expect(updateCall.lines[0].quantityReceived).toBe(8);
  });
});

describe('PurchasesService.listFilter (via findAll) — search input is regex-escaped', () => {
  let service: PurchasesService;
  const tenantId = new Types.ObjectId().toString();
  const purchaseModel: any = { find: jest.fn(), countDocuments: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const findChain: any = { sort: () => findChain, skip: () => findChain, limit: () => findChain, lean: () => Promise.resolve([]) };
    purchaseModel.find.mockReturnValue(findChain);
    purchaseModel.countDocuments.mockReturnValue(chain(0));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchasesService,
        { provide: getModelToken(Purchase.name), useValue: purchaseModel },
        { provide: getModelToken(ProductVariant.name), useValue: {} },
        { provide: getModelToken(Material.name), useValue: {} },
        { provide: ExcelSpreadsheetService, useValue: {} },
        { provide: LocationsService, useValue: {} },
        { provide: ProductsService, useValue: {} },
      ],
    }).compile();
    service = module.get<PurchasesService>(PurchasesService);
  });

  it('escapes regex metacharacters instead of passing raw user input to RegExp', async () => {
    await service.findAll(tenantId, 1, 20, '(a+)+$');

    const filter = purchaseModel.find.mock.calls[0][0];
    const referenceRegex = filter.$or.find((c: any) => c.reference)?.reference as RegExp;
    expect(referenceRegex).toBeInstanceOf(RegExp);
    expect(referenceRegex.source).toBe('\\(a\\+\\)\\+\\$');
  });
});
