import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { OnEvent } from '@nestjs/event-emitter';
import { Integration, IntegrationDocument } from './schemas/integration.schema';
import { SyncLog } from './schemas/sync-log.schema';
import { ProductVariant } from '../products/schemas/product-variant.schema';
import { IntegrationsService } from './integrations.service';
import { ProductMappingService } from './product-mapping.service';
import { StockUpdate } from './adapters/platform-adapter.interface';
import { OrdersService } from '../orders/orders.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { CustomersService } from '../customers/customers.service';
import { TiktokAdapter } from './adapters/tiktok.adapter';

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
    @InjectModel(Integration.name) private readonly integrationModel: Model<Integration>,
    private readonly integrationsService: IntegrationsService,
    private readonly mappingService: ProductMappingService,
    private readonly orders: OrdersService,
    private readonly fiscal: FiscalService,
    private readonly customers: CustomersService,
    private readonly tiktokAdapter: TiktokAdapter,
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

  /** Cliente genérico usado pra pedidos importados de canais que não trazem cadastro de comprador. */
  private async findOrCreateChannelCustomer(tenantId: string, label: string) {
    const existing = await this.customers.findFirstByHint(tenantId, label);
    if (existing) return existing;
    return this.customers.create(tenantId, { name: label });
  }

  /**
   * Puxa pedidos novos da plataforma externa, cria como pedido Kivoni (status
   * `completed` — o canal já confirmou/pagou o pedido do lado dele), emite a nota
   * fiscal e, se a plataforma expõe upload de nota (TikTok Shop), sobe o DANFE de
   * volta pro pedido de origem. Dedupe por `reference = "{platform}:{externalId}"`.
   */
  async syncOrders(tenantId: string, integrationId: string): Promise<{ imported: number; skipped: number; failed: number }> {
    const integration = await this.integrationsService.findOne(tenantId, integrationId);
    const adapter = this.integrationsService.getAdapter(integration.platform);
    if (!adapter.listOrders) return { imported: 0, skipped: 0, failed: 0 };

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const since = integration.lastOrderSyncAt;
    const syncStart = new Date();

    let iterator = adapter.listOrders(integration.credentials, since);
    let refreshedOnce = false;

    while (true) {
      let step: IteratorResult<any>;
      try {
        step = await iterator.next();
      } catch (err: any) {
        if (!refreshedOnce && (await this.tryRefreshTiktokToken(integration, err))) {
          refreshedOnce = true;
          iterator = adapter.listOrders(integration.credentials, since);
          continue;
        }
        await this.logOrderSync(tenantId, integrationId, 'error', { error: err.message });
        return { imported, skipped, failed: failed + 1 };
      }
      if (step.done) break;
      const extOrder = step.value;

      const reference = `${integration.platform}:${extOrder.externalId}`;
      try {
        const already = await this.orders.findByReference(tenantId, reference);
        if (already) {
          skipped++;
          continue;
        }

        const lines: Array<{ variantId: string; quantity: number; unitPrice: number }> = [];
        for (const line of extOrder.lines) {
          const mapping = await this.mappingService.findByExternalVariant(integrationId, line.externalVariantId);
          if (!mapping?.variantId) {
            this.logger.warn(`Sem mapeamento pra variante externa ${line.externalVariantId} (pedido ${extOrder.externalId}) — linha ignorada`);
            continue;
          }
          lines.push({ variantId: String(mapping.variantId), quantity: line.quantity, unitPrice: line.unitPrice });
        }
        if (!lines.length) {
          skipped++;
          continue;
        }

        const customer = await this.findOrCreateChannelCustomer(tenantId, `Cliente ${integration.label || integration.platform}`);
        const order = await this.orders.create(tenantId, {
          customerId: String((customer as any)._id),
          channel: 'online',
          status: 'completed',
          reference,
          lines,
        });
        imported++;

        // Emite NF-e/NFC-e e, se der certo e a plataforma suportar, sobe a nota pro pedido de origem.
        try {
          const doc = await this.fiscal.emitForOrder(tenantId, String((order as any)._id));
          if (doc.status === 'authorized' && doc.danfeUrl && integration.platform === 'tiktok') {
            const upload = await this.tiktokAdapter.uploadInvoice(integration.credentials, extOrder.externalId, { fileUrl: doc.danfeUrl });
            if (!upload.ok) {
              this.logger.warn(`Upload de nota falhou pro pedido ${extOrder.externalId}: ${upload.error}`);
            }
          }
        } catch (fiscalErr: any) {
          // Pedido já foi importado; a nota pode ser emitida manualmente depois pela tela fiscal.
          this.logger.error(`Emissão fiscal falhou pro pedido importado ${reference}: ${fiscalErr.message}`);
        }
      } catch (err: any) {
        failed++;
        this.logger.error(`Falha ao importar pedido ${extOrder?.externalId}: ${err.message}`);
      }
    }

    await this.integrationModel.updateOne({ _id: integrationId }, { $set: { lastOrderSyncAt: syncStart } }).exec();
    await this.logOrderSync(tenantId, integrationId, failed === 0 ? 'success' : 'error', { imported, skipped, failed });
    return { imported, skipped, failed };
  }

  private async logOrderSync(tenantId: string, integrationId: string, status: 'success' | 'error', details: Record<string, unknown>) {
    await this.syncLogModel.create({
      tenantId: new Types.ObjectId(tenantId),
      integrationId: new Types.ObjectId(integrationId),
      type: 'order_pull',
      status,
      details,
      errorMessage: status === 'error' ? String(details.error ?? 'falha na importação de pedidos') : undefined,
    });
  }

  /** Só o TikTok Shop tem refresh de token implementado hoje; outras plataformas retornam false (sem retry). */
  private async tryRefreshTiktokToken(integration: IntegrationDocument, err: any): Promise<boolean> {
    if (integration.platform !== 'tiktok') return false;
    const { applicationKey, apiKey, refreshToken } = integration.credentials;
    if (!applicationKey || !apiKey || !refreshToken) return false;
    const result = await this.tiktokAdapter.refreshAccessToken(applicationKey, apiKey, refreshToken);
    if (!result.ok || !result.accessToken) {
      this.logger.error(`Refresh de token TikTok falhou pra integração ${integration._id}: ${result.error ?? err.message}`);
      return false;
    }
    await this.integrationModel.updateOne(
      { _id: integration._id },
      { $set: { 'credentials.accessToken': result.accessToken, 'credentials.refreshToken': result.refreshToken ?? refreshToken } },
    ).exec();
    integration.credentials.accessToken = result.accessToken;
    if (result.refreshToken) integration.credentials.refreshToken = result.refreshToken;
    return true;
  }

  async fullSync(tenantId: string, integrationId: string): Promise<{ mapped: number; unmapped: number; stockPushed: number; ordersImported?: number }> {
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

    // Step 4: Pull orders (fiscal emission + invoice upload happen inside syncOrders)
    let ordersImported: number | undefined;
    if (integration.syncOrders) {
      const orderResult = await this.syncOrders(tenantId, integrationId);
      ordersImported = orderResult.imported;
    }

    await this.syncLogModel.create({
      tenantId: new Types.ObjectId(tenantId),
      integrationId: new Types.ObjectId(integrationId),
      type: 'stock_push',
      status: 'success',
      details: { mapped: mapResult.mapped, unmapped: mapResult.unmapped, stockPushed, ordersImported },
      duration: Date.now() - start,
    });

    await this.integrationsService.updateSyncStatus(integrationId, 'success');

    return { ...mapResult, stockPushed, ordersImported };
  }

  async getSyncLogs(integrationId: string, limit = 20): Promise<any[]> {
    return this.syncLogModel
      .find({ integrationId: new Types.ObjectId(integrationId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }
}
