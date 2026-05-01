import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ProductVariant,
  ProductVariantSchema,
} from '../products/schemas/product-variant.schema';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { OrderDraft, OrderDraftSchema } from './schemas/order-draft.schema';
import { OrderDraftsService } from './order-drafts.service';
import { PublicOrderDraftsController } from './public-order-drafts.controller';
import { OrderDraftsController } from './order-drafts.controller';

@Module({
  imports: [
    OrdersModule,
    PaymentsModule,
    MongooseModule.forFeature([
      { name: OrderDraft.name, schema: OrderDraftSchema },
      { name: ProductVariant.name, schema: ProductVariantSchema },
    ]),
  ],
  controllers: [PublicOrderDraftsController, OrderDraftsController],
  providers: [OrderDraftsService],
  exports: [OrderDraftsService],
})
export class OrderDraftsModule {}
