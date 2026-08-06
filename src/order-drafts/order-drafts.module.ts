import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ProductVariant,
  ProductVariantSchema,
} from '../products/schemas/product-variant.schema';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { CustomersModule } from '../customers/customers.module';
import { ProductsModule } from '../products/products.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrderDraft, OrderDraftSchema } from './schemas/order-draft.schema';
import { OrderDraftsService } from './order-drafts.service';
import { PublicOrderDraftsController } from './public-order-drafts.controller';
import { OrderDraftsController } from './order-drafts.controller';
import { AbandonedCartCron } from './abandoned-cart.cron';

@Module({
  imports: [
    OrdersModule,
    PaymentsModule,
    CustomersModule,
    ProductsModule,
    PromotionsModule,
    NotificationsModule,
    MongooseModule.forFeature([
      { name: OrderDraft.name, schema: OrderDraftSchema },
      { name: ProductVariant.name, schema: ProductVariantSchema },
      { name: Customer.name, schema: CustomerSchema },
    ]),
  ],
  controllers: [PublicOrderDraftsController, OrderDraftsController],
  providers: [OrderDraftsService, AbandonedCartCron],
  exports: [OrderDraftsService],
})
export class OrderDraftsModule {}
