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
});
