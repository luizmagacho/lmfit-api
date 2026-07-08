import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { OnEvent } from '@nestjs/event-emitter';
import { Integration } from './schemas/integration.schema';
import { SyncLog } from './schemas/sync-log.schema';
import { ProductVariant } from '../products/schemas/product-variant.schema';
import { IntegrationsService } from './integrations.service';
import { ProductMappingService } from './product-mapping.service';
import { StockUpdate } from './adapters/platform-adapter.interface';

export interface StockChangedEvent {
  tenantId: string;
  variantId: string;
  newQuantity: number;
  reason: string;
}

@Injectable()
export class SyncEngineService {
  private readonly logger = new Logger(SyncEngineService.name);

  constructor(
    @InjectModel(SyncLog.name) private readonly syncLogModel: Model<SyncLog>,
    @InjectModel(ProductVariant.name) private readonly variantModel: Model<ProductVariant>,
    private readonly integrationsService: IntegrationsService,
    private readonly mappingService: ProductMappingService,
  ) {}

  @OnEvent('stock.changed', { async: true })
  async handleStockChanged(event: StockChangedEvent): Promise<void> {
    this.logger.debug(`Stock changed event: variant=${event.variantId}, qty=${event.newQuantity}, reason=${event.reason}`);

    try {
      const integrations = await this.integrationsService.findActiveByTenant(event.tenantId);
      const stockIntegrations = integrations.filter(i => i.syncStock);

      if (stockIntegrations.length === 0) return;

      for (const integration of stockIntegrations) {
        await this.pushStockForVariant(integration, event.variantId, event.newQuantity);
      }
    } catch (err: any) {
      this.logger.error(`Failed to handle stock.changed event: ${err.message}`, err.stack);
    }
  }

  async pushStockForVariant(integration: any, variantId: string, quantity: number): Promise<void> {
    const start = Date.now();
    const mapping = await this.mappingService.findByVariant(integration._id.toString(), variantId);

    if (!mapping || !mapping.externalVariantId) {
      this.logger.debug(`No mapping found for variant ${variantId} in integration ${integration._id}`);
      return;
    }

    try {
      const adapter = this.integrationsService.getAdapter(integration.platform);
      const updates: StockUpdate[] = [{ externalVariantId: mapping.externalVariantId, quantity }];
      const results = await adapter.updateStock?.(integration.credentials, updates) ?? [];

      const allSuccess = results.every((r: any) => r.success);

      await this.syncLogModel.create({
        tenantId: integration.tenantId,
        integrationId: integration._id,
        type: 'stock_push',
        status: allSuccess ? 'success' : 'error',
        details: { variantId, externalVariantId: mapping.externalVariantId, quantity, results },
        errorMessage: allSuccess ? undefined : results.find((r: any) => !r.success)?.error,
        duration: Date.now() - start,
      });

      if (allSuccess) {
        await this.integrationsService.updateSyncStatus(integration._id.toString(), 'success');
      } else {
        await this.integrationsService.updateSyncStatus(integration._id.toString(), 'error', 'Stock push partially failed');
      }
    } catch (err: any) {
      this.logger.error(`Stock push failed for integration ${integration._id}: ${err.message}`);
      await this.syncLogModel.create({
        tenantId: integration.tenantId,
        integrationId: integration._id,
        type: 'stock_push',
        status: 'error',
        errorMessage: err.message,
        duration: Date.now() - start,
      });
      await this.integrationsService.updateSyncStatus(integration._id.toString(), 'error', err.message);
    }
  }

  /** Empurra o estoque atual de todas as variantes mapeadas para a plataforma externa. */
  async pushStockForAllMappings(integration: {
    _id: Types.ObjectId | string;
    platform: string;
    credentials: unknown;
  }): Promise<{ pushed: number; failed: number }> {
    const integrationId = String(integration._id);
    const adapter = this.integrationsService.getAdapter(integration.platform);
    const mappings = await this.mappingService.findAllByIntegration(integrationId);
    const stockUpdates: StockUpdate[] = [];

    for (const mapping of mappings) {
      if (!mapping.variantId || !mapping.externalVariantId) continue;
      const variant = await this.variantModel.findById(mapping.variantId).exec();
      if (variant) {
        stockUpdates.push({ externalVariantId: mapping.externalVariantId, quantity: variant.quantityOnHand });
      }
    }

    if (stockUpdates.length === 0) return { pushed: 0, failed: 0 };
    const results = await adapter.updateStock?.(integration.credentials, stockUpdates) ?? [];
    const pushed = results.filter((r: any) => r.success).length;
    const failed = results.length - pushed;
    await this.integrationsService.updateSyncStatus(
      integrationId,
      failed === 0 ? 'success' : pushed > 0 ? 'partial' : 'error',
      failed === 0 ? undefined : results.find((r: any) => !r.success)?.error,
    );
    return { pushed, failed };
  }

  async fullSync(tenantId: string, integrationId: string): Promise<{ mapped: number; unmapped: number; stockPushed: number }> {
    const start = Date.now();
    const integration = await this.integrationsService.findOne(tenantId, integrationId);
    const adapter = this.integrationsService.getAdapter(integration.platform);

    // Step 1: Pull products from external platform
    const externalProducts: Array<{ externalId: string; variants?: Array<{ externalId: string; sku?: string }> }> = [];
    for await (const product of adapter.listProducts?.(integration.credentials) ?? []) {
      externalProducts.push({
        externalId: product.externalId,
        variants: product.variants?.map((v: any) => ({ externalId: v.externalId, sku: v.sku })),
      });
    }

    // Step 2: Auto-map by SKU
    const mapResult = await this.mappingService.autoMapBySku(tenantId, integrationId, externalProducts);

    // Step 3: Push current stock for all mapped variants
    const { pushed: stockPushed } = await this.pushStockForAllMappings(integration);

    await this.syncLogModel.create({
      tenantId: new Types.ObjectId(tenantId),
      integrationId: new Types.ObjectId(integrationId),
      type: 'stock_push',
      status: 'success',
      details: { mapped: mapResult.mapped, unmapped: mapResult.unmapped, stockPushed },
      duration: Date.now() - start,
    });

    await this.integrationsService.updateSyncStatus(integrationId, 'success');

    return { ...mapResult, stockPushed };
  }

  async getSyncLogs(integrationId: string, limit = 20): Promise<any[]> {
    return this.syncLogModel
      .find({ integrationId: new Types.ObjectId(integrationId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }
}
