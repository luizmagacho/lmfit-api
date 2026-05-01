import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrdersModule } from '../orders/orders.module';
import { PaymentWebhookDispatcherService } from './payment-webhook-dispatcher.service';
import { PaymentsService } from './payments.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { PublicPaymentsController } from './public-payments.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Payment.name, schema: PaymentSchema }]),
    forwardRef(() => OrdersModule),
  ],
  controllers: [PublicPaymentsController],
  providers: [PaymentsService, PaymentWebhookDispatcherService],
  exports: [PaymentsService, PaymentWebhookDispatcherService],
})
export class PaymentsModule {}
