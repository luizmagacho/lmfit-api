import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Integration, IntegrationSchema } from './schemas/integration.schema';
import { ProductMapping, ProductMappingSchema } from './schemas/product-mapping.schema';
import { SyncLog, SyncLogSchema } from './schemas/sync-log.schema';
import { ProductVariant, ProductVariantSchema } from '../products/schemas/product-variant.schema';
import { OrdersModule } from '../orders/orders.module';
import { FiscalModule } from '../fiscal/fiscal.module';
import { CustomersModule } from '../customers/customers.module';
import { IntegrationsService } from './integrations.service';
import { ProductMappingService } from './product-mapping.service';
import { SyncEngineService } from './sync-engine.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsWebhookController } from './integrations-webhook.controller';
import { BagyAdapter } from './adapters/bagy.adapter';
import { NuvemshopAdapter } from './adapters/nuvemshop.adapter';
import { TrayAdapter } from './adapters/tray.adapter';
import { LojaIntegradaAdapter } from './adapters/loja-integrada.adapter';
import { ShopifyAdapter } from './adapters/shopify.adapter';
import { MercadoLivreAdapter } from './adapters/mercadolivre.adapter';
import { ShopeeAdapter } from './adapters/shopee.adapter';
import { TiktokAdapter } from './adapters/tiktok.adapter';
import { SyncCronService } from './sync-cron.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Integration.name, schema: IntegrationSchema },
      { name: ProductMapping.name, schema: ProductMappingSchema },
      { name: SyncLog.name, schema: SyncLogSchema },
      { name: ProductVariant.name, schema: ProductVariantSchema },
    ]),
    OrdersModule,
    FiscalModule,
    CustomersModule,
  ],
  controllers: [IntegrationsController, IntegrationsWebhookController],
  providers: [
    BagyAdapter,
    NuvemshopAdapter,
    TrayAdapter,
    LojaIntegradaAdapter,
    ShopifyAdapter,
    MercadoLivreAdapter,
    ShopeeAdapter,
    TiktokAdapter,
    IntegrationsService,
    ProductMappingService,
    SyncEngineService,
    SyncCronService,
  ],
  exports: [IntegrationsService, SyncEngineService],
})
export class IntegrationsModule {}
