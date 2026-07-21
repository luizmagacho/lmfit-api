import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MaterialsService } from './materials.service';
import { Material } from './schemas/material.schema';

describe('MaterialsService', () => {
  let service: MaterialsService;
  const model = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    countDocuments: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaterialsService,
        { provide: getModelToken(Material.name), useValue: model },
      ],
    }).compile();

    service = module.get<MaterialsService>(MaterialsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('scopes findOne by tenantId and rejects an invalid id', async () => {
    await expect(service.findOne('507f1f77bcf86cd799439011', 'not-an-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(model.findOne).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when no document matches the tenant', async () => {
    model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    const id = new Types.ObjectId().toString();
    await expect(service.findOne('507f1f77bcf86cd799439011', id)).rejects.toBeInstanceOf(NotFoundException);
    expect(model.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: id }),
    );
  });

  describe('findAll', () => {
    function mockFind(items: unknown[]) {
      const sort = jest.fn().mockReturnThis();
      const skip = jest.fn().mockReturnThis();
      const limit = jest.fn().mockReturnThis();
      const exec = jest.fn().mockResolvedValue(items);
      model.find.mockReturnValue({ sort, skip, limit, exec });
      return { sort, skip, limit, exec };
    }

    it('returns { items, total, page, limit } — a bare array here silently renders an empty' +
      ' admin table even though create/update succeed (the exact reported bug)', async () => {
      const items = [{ _id: '1', name: 'Malha PV' }];
      mockFind(items);
      model.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(1) });

      const result = await service.findAll('507f1f77bcf86cd799439011', 1, 20);

      expect(result).toEqual({ items, total: 1, page: 1, limit: 20 });
    });

    it('applies skip/limit derived from page/limit', async () => {
      const { skip, limit } = mockFind([]);
      model.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.findAll('507f1f77bcf86cd799439011', 3, 10);

      expect(skip).toHaveBeenCalledWith(20); // (page 3 - 1) * limit 10
      expect(limit).toHaveBeenCalledWith(10);
    });

    it('scopes the search filter by name (case-insensitive), still tenant-scoped', async () => {
      mockFind([]);
      model.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });

      await service.findAll('507f1f77bcf86cd799439011', 1, 20, 'malha');

      const q = model.find.mock.calls[0][0];
      expect(q.tenantId).toBeDefined();
      expect(q.name).toBeInstanceOf(RegExp);
      expect(q.name.test('Malha PV 40')).toBe(true);
    });
  });
});
