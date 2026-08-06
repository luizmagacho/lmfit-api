import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ProductVariant,
  ProductVariantSchema,
} from '../products/schemas/product-variant.schema';
import { ProductsModule } from '../products/products.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { Order, OrderSchema } from './schemas/order.schema';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { PaymentsModule } from '../payments/payments.module';
import { Counter, CounterSchema } from '../common/counters/counter.schema';
import { CountersService } from '../common/counters/counters.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: ProductVariant.name, schema: ProductVariantSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: Counter.name, schema: CounterSchema },
    ]),
    ProductsModule,
    PurchasesModule,
    LoyaltyModule,
    PromotionsModule,
    forwardRef(() => PaymentsModule),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, CountersService],
  exports: [OrdersService],
})
export class OrdersModule {}
