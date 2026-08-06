import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrdersModule } from '../orders/orders.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { PaymentWebhookDispatcherService } from './payment-webhook-dispatcher.service';
import { PaymentsService } from './payments.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { FailedWebhook, FailedWebhookSchema } from './schemas/failed-webhook.schema';
import { PublicPaymentsController } from './public-payments.controller';
import { PaymentsController } from './payments.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: FailedWebhook.name, schema: FailedWebhookSchema },
    ]),
    forwardRef(() => OrdersModule),
    AnalyticsModule,
  ],
  controllers: [PublicPaymentsController, PaymentsController],
  providers: [PaymentsService, PaymentWebhookDispatcherService],
  exports: [PaymentsService, PaymentWebhookDispatcherService],
})
export class PaymentsModule {}
