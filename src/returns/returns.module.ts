import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { ProductsModule } from '../products/products.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ReturnRecord, ReturnSchema } from './schemas/return.schema';
import { ReturnsController, ReturnsHistoryController } from './returns.controller';
import { PublicReturnsController } from './public-returns.controller';
import { ReturnsService } from './returns.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReturnRecord.name, schema: ReturnSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: Payment.name, schema: PaymentSchema },
    ]),
    ProductsModule,
    TenantsModule,
  ],
  controllers: [ReturnsController, ReturnsHistoryController, PublicReturnsController],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
