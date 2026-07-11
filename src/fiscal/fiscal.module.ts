import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { ProductVariant, ProductVariantSchema } from '../products/schemas/product-variant.schema';
import { TenantsModule } from '../tenants/tenants.module';
import { FocusNfeAdapter } from './adapters/focus-nfe.adapter';
import { FiscalController, FiscalHistoryController } from './fiscal.controller';
import { FiscalService } from './fiscal.service';
import { FiscalDocument, FiscalDocumentSchema } from './schemas/fiscal-document.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FiscalDocument.name, schema: FiscalDocumentSchema },
      { name: Order.name, schema: OrderSchema },
      { name: ProductVariant.name, schema: ProductVariantSchema },
    ]),
    TenantsModule,
  ],
  controllers: [FiscalController, FiscalHistoryController],
  providers: [FiscalService, FocusNfeAdapter],
  exports: [FiscalService],
})
export class FiscalModule {}
