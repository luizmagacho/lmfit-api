import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ProductVariant,
  ProductVariantSchema,
} from '../products/schemas/product-variant.schema';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
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
import { CheckoutCanaryCron } from './checkout-canary.cron';
import { CheckoutAlertService } from './checkout-alert.service';

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
      // Loop 26 — só pra CheckoutCanaryCron podar pedidos antigos do tenant sintético; OrdersModule
      // não exporta o model, e registrar o mesmo schema num segundo forFeature() é seguro (mesma
      // conexão Mongoose, só mais um token de DI).
      { name: Order.name, schema: OrderSchema },
    ]),
  ],
  controllers: [PublicOrderDraftsController, OrderDraftsController],
  providers: [OrderDraftsService, AbandonedCartCron, CheckoutCanaryCron, CheckoutAlertService],
  exports: [OrderDraftsService],
})
export class OrderDraftsModule {}
