import { BadRequestException, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Integration, IntegrationDocument } from './schemas/integration.schema';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { UpdateIntegrationDto } from './dto/update-integration.dto';
import { ConnectTiktokDto } from './dto/connect-tiktok.dto';
import { BagyAdapter } from './adapters/bagy.adapter';
import { NuvemshopAdapter } from './adapters/nuvemshop.adapter';
import { TrayAdapter } from './adapters/tray.adapter';
import { LojaIntegradaAdapter } from './adapters/loja-integrada.adapter';
import { ShopifyAdapter } from './adapters/shopify.adapter';
import { MercadoLivreAdapter } from './adapters/mercadolivre.adapter';
import { ShopeeAdapter } from './adapters/shopee.adapter';
import { TiktokAdapter } from './adapters/tiktok.adapter';
import { PlatformAdapter } from './adapters/platform-adapter.interface';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);
  private readonly adapters: Map<string, PlatformAdapter> = new Map();

  constructor(
    @InjectModel(Integration.name) private readonly model: Model<Integration>,
    private readonly bagyAdapter: BagyAdapter,
    private readonly nuvemshopAdapter: NuvemshopAdapter,
    private readonly trayAdapter: TrayAdapter,
    private readonly lojaIntegradaAdapter: LojaIntegradaAdapter,
    private readonly shopifyAdapter: ShopifyAdapter,
    private readonly mercadoLivreAdapter: MercadoLivreAdapter,
    private readonly shopeeAdapter: ShopeeAdapter,
    private readonly tiktokAdapter: TiktokAdapter,
  ) {
    this.adapters.set('bagy', this.bagyAdapter);
    this.adapters.set('nuvemshop', this.nuvemshopAdapter);
    this.adapters.set('tray', this.trayAdapter);
    this.adapters.set('loja_integrada', this.lojaIntegradaAdapter);
    this.adapters.set('shopify', this.shopifyAdapter);
    this.adapters.set('mercadolivre', this.mercadoLivreAdapter);
    this.adapters.set('shopee', this.shopeeAdapter);
    this.adapters.set('tiktok', this.tiktokAdapter);
  }

  getAdapter(platform: string): PlatformAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) throw new NotFoundException(`Platform adapter "${platform}" not found`);
    return adapter;
  }

  async create(tenantId: string, dto: CreateIntegrationDto): Promise<IntegrationDocument> {
    const adapter = this.getAdapter(dto.platform);
    const testResult = await adapter.testConnection(dto.credentials);
    if (!testResult?.ok) {
      throw new BadRequestException({
        message: `Falha ao conectar: ${testResult?.error ?? 'verifique o token e as credenciais.'}`,
      });
    }

    const doc = await this.model.create({
      tenantId: new Types.ObjectId(tenantId),
      ...dto,
      label: dto.label || testResult.storeName || `${dto.platform} store`,
    });
    this.logger.log(`Integration created: ${doc._id} (${dto.platform}) for tenant ${tenantId}`);
    return doc;
  }

  /**
   * Fluxo dedicado do TikTok Shop: troca o `auth_code` da autorização por
   * access/refresh token + shop_cipher e já cria a integração — não passa pelo
   * `create()` genérico porque `testConnection` exige um access_token que ainda
   * não existe antes dessa troca.
   */
  async connectTiktok(tenantId: string, dto: ConnectTiktokDto): Promise<IntegrationDocument> {
    const exchange = await this.tiktokAdapter.exchangeAuthCode(dto.applicationKey, dto.apiKey, dto.authCode);
    if (!exchange.ok || !exchange.accessToken) {
      throw new BadRequestException(`Falha ao autorizar com o TikTok Shop: ${exchange.error ?? 'auth_code inválido ou expirado.'}`);
    }

    const credentials = {
      applicationKey: dto.applicationKey,
      apiKey: dto.apiKey,
      accessToken: exchange.accessToken,
      refreshToken: exchange.refreshToken,
      shopCipher: exchange.shopCipher,
      storeId: exchange.shopId,
    };

    let storeName = dto.label;
    if (!storeName) {
      const test = await this.tiktokAdapter.testConnection(credentials).catch(() => null);
      storeName = test?.storeName ?? 'Loja TikTok Shop';
    }

    const doc = await this.model.create({
      tenantId: new Types.ObjectId(tenantId),
      platform: 'tiktok',
      label: storeName,
      credentials,
      syncOrders: true,
    });
    this.logger.log(`TikTok Shop integration created: ${doc._id} for tenant ${tenantId}`);
    return doc;
  }

  async findAll(tenantId: string): Promise<IntegrationDocument[]> {
    return this.model.find({ tenantId: new Types.ObjectId(tenantId) }).sort({ createdAt: -1 }).exec();
  }

  async findOne(tenantId: string, id: string): Promise<IntegrationDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model.findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) }).exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async findActiveByTenant(tenantId: string): Promise<IntegrationDocument[]> {
    return this.model.find({ tenantId: new Types.ObjectId(tenantId), active: true }).exec();
  }

  async update(tenantId: string, id: string, dto: UpdateIntegrationDto): Promise<IntegrationDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model.findOneAndUpdate(
      { _id: id, tenantId: new Types.ObjectId(tenantId) },
      { $set: dto },
      { new: true, returnDocument: 'after' },
    ).exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async remove(tenantId: string, id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const result = await this.model.deleteOne({ _id: id, tenantId: new Types.ObjectId(tenantId) }).exec();
    if (result.deletedCount === 0) throw new NotFoundException();
  }

  async testConnection(tenantId: string, id: string) {
    const integration = await this.findOne(tenantId, id);
    const adapter = this.getAdapter(integration.platform);
    return adapter.testConnection(integration.credentials);
  }

  async updateSyncStatus(id: string, status: 'success' | 'partial' | 'error', error?: string): Promise<void> {
    await this.model.findByIdAndUpdate(id, {
      $set: {
        lastSyncAt: new Date(),
        lastSyncStatus: status,
        lastSyncError: error || null,
      },
    }).exec();
  }
}
