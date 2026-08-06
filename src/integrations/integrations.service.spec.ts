import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { IntegrationsService } from './integrations.service';

describe('IntegrationsService', () => {
  const tenantId = new Types.ObjectId().toString();
  const model: any = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };
  const bagyAdapter: any = { platform: 'bagy' };
  const nuvemshopAdapter: any = { platform: 'nuvemshop' };
  const trayAdapter: any = { platform: 'tray' };
  const lojaIntegradaAdapter: any = { platform: 'loja_integrada' };
  const shopifyAdapter: any = { platform: 'shopify' };
  const mercadoLivreAdapter: any = { platform: 'mercadolivre' };
  const shopeeAdapter: any = { platform: 'shopee' };
  const tiktokAdapter: any = {
    platform: 'tiktok',
    exchangeAuthCode: jest.fn(),
    testConnection: jest.fn(),
  };

  const service = new IntegrationsService(
    model,
    bagyAdapter,
    nuvemshopAdapter,
    trayAdapter,
    lojaIntegradaAdapter,
    shopifyAdapter,
    mercadoLivreAdapter,
    shopeeAdapter,
    tiktokAdapter,
  );

  beforeEach(() => jest.clearAllMocks());

  describe('getAdapter', () => {
    it('resolves every platform the schema enum declares, including tiktok', () => {
      expect(service.getAdapter('tiktok')).toBe(tiktokAdapter);
      expect(service.getAdapter('bagy')).toBe(bagyAdapter);
      expect(service.getAdapter('mercadolivre')).toBe(mercadoLivreAdapter);
      expect(service.getAdapter('shopee')).toBe(shopeeAdapter);
    });

    it('throws NotFoundException for an unknown platform', () => {
      expect(() => service.getAdapter('not-a-platform')).toThrow(NotFoundException);
    });
  });

  describe('connectTiktok', () => {
    const dto = { applicationKey: 'app-key', apiKey: 'app-secret', authCode: 'code-123', label: 'Minha Loja Teste' };

    it('exchanges the auth_code and creates the integration with the exchanged credentials', async () => {
      tiktokAdapter.exchangeAuthCode.mockResolvedValue({
        ok: true,
        accessToken: 'at-1',
        refreshToken: 'rt-1',
        shopCipher: 'cipher-1',
        shopId: 'shop-1',
      });
      model.create.mockResolvedValue({ _id: new Types.ObjectId() });

      await service.connectTiktok(tenantId, dto as any);

      expect(tiktokAdapter.exchangeAuthCode).toHaveBeenCalledWith(dto.applicationKey, dto.apiKey, dto.authCode);
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: 'tiktok',
          syncOrders: true,
          credentials: expect.objectContaining({
            applicationKey: 'app-key',
            apiKey: 'app-secret',
            accessToken: 'at-1',
            refreshToken: 'rt-1',
            shopCipher: 'cipher-1',
            storeId: 'shop-1',
          }),
        }),
      );
    });

    it('throws BadRequestException when the auth_code exchange fails, without ever calling create()', async () => {
      tiktokAdapter.exchangeAuthCode.mockResolvedValue({ ok: false, error: 'auth_code expirado' });

      await expect(service.connectTiktok(tenantId, dto as any)).rejects.toThrow(BadRequestException);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('falls back to testConnection for the store name when no label is given', async () => {
      tiktokAdapter.exchangeAuthCode.mockResolvedValue({ ok: true, accessToken: 'at-1' });
      tiktokAdapter.testConnection.mockResolvedValue({ ok: true, storeName: 'Minha Loja TikTok' });
      model.create.mockResolvedValue({ _id: new Types.ObjectId() });

      await service.connectTiktok(tenantId, { ...dto, label: undefined } as any);

      expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ label: 'Minha Loja TikTok' }));
    });
  });

  describe('findByTenantAndPlatform', () => {
    it('queries by tenantId + platform + active:true', async () => {
      const exec = jest.fn().mockResolvedValue({ _id: 'integration-1' });
      model.findOne.mockReturnValue({ exec });

      const result = await service.findByTenantAndPlatform(tenantId, 'tiktok');

      expect(model.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'tiktok', active: true }),
      );
      expect(result).toEqual({ _id: 'integration-1' });
    });

    it('returns null when no active integration exists for that platform', async () => {
      const exec = jest.fn().mockResolvedValue(null);
      model.findOne.mockReturnValue({ exec });

      const result = await service.findByTenantAndPlatform(tenantId, 'shopee');
      expect(result).toBeNull();
    });
  });
});
