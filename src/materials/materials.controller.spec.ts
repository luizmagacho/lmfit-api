import { Test, TestingModule } from '@nestjs/testing';
import { MaterialsController } from './materials.controller';
import { MaterialsService } from './materials.service';

describe('MaterialsController', () => {
  let controller: MaterialsController;
  const service = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MaterialsController],
      providers: [{ provide: MaterialsService, useValue: service }],
    }).compile();

    controller = module.get<MaterialsController>(MaterialsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates create to the service with the resolved tenantId', async () => {
    const dto = { name: 'Malha PV', unit: 'kg' } as any;
    service.create.mockResolvedValue({ _id: '1', ...dto });
    await controller.create('tenant-1', dto);
    expect(service.create).toHaveBeenCalledWith('tenant-1', dto);
  });

  it('delegates findAll with the parsed pagination query (page/limit/search)', async () => {
    service.findAll.mockResolvedValue({ items: [], total: 0, page: 2, limit: 10 });
    await controller.findAll({ page: 2, limit: 10, search: 'malha' } as any, 'tenant-1');
    expect(service.findAll).toHaveBeenCalledWith('tenant-1', 2, 10, 'malha');
  });
});
