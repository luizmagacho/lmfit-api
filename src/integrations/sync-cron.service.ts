import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Integration, IntegrationDocument } from './schemas/integration.schema';
import { SyncEngineService } from './sync-engine.service';

@Injectable()
export class SyncCronService {
  private readonly logger = new Logger(SyncCronService.name);

  constructor(
    @InjectModel(Integration.name) private readonly integrationModel: Model<Integration>,
    private readonly syncEngine: SyncEngineService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handlePeriodicSync() {
    this.logger.log('Starting periodic sync for active integrations...');

    try {
      // Find all active integrations that have syncStock enabled
      const activeIntegrations: IntegrationDocument[] = await this.integrationModel.find({
        active: true,
        syncStock: true,
      });

      if (activeIntegrations.length === 0) {
        this.logger.log('No active integrations requiring stock sync.');
        return;
      }

      this.logger.log(`Found ${activeIntegrations.length} active integration(s) for periodic sync.`);

      for (const integration of activeIntegrations) {
        try {
          this.logger.log(`Syncing stock for tenant ${integration.tenantId} platform ${integration.platform}`);
          const { pushed, failed } = await this.syncEngine.pushStockForAllMappings(integration);
          if (pushed || failed) {
            this.logger.log(`Stock push done for ${integration.platform}: ${pushed} ok, ${failed} failed`);
          }
        } catch (error: any) {
          this.logger.error(
            `Failed to sync stock for tenant ${integration.tenantId} platform ${integration.platform}: ${error.message}`,
          );
        }
      }

      // Pedidos: emite fiscal + sobe nota (TikTok Shop) automaticamente, sem precisar de clique manual.
      const orderIntegrations: IntegrationDocument[] = await this.integrationModel.find({
        active: true,
        syncOrders: true,
      });
      for (const integration of orderIntegrations) {
        try {
          const result = await this.syncEngine.syncOrders(String(integration.tenantId), String(integration._id));
          if (result.imported || result.failed) {
            this.logger.log(
              `Order sync for ${integration.platform}: ${result.imported} imported, ${result.skipped} skipped, ${result.failed} failed`,
            );
          }
        } catch (error: any) {
          this.logger.error(
            `Failed to sync orders for tenant ${integration.tenantId} platform ${integration.platform}: ${error.message}`,
          );
        }
      }

      this.logger.log('Periodic sync completed.');
    } catch (error: any) {
      this.logger.error(`Failed to retrieve integrations for periodic sync: ${error.message}`);
    }
  }
}
