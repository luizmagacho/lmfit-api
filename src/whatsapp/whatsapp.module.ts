import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CustomersModule } from '../customers/customers.module';
import { GeminiModule } from '../gemini/gemini.module';
import { OrdersModule } from '../orders/orders.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { InboundMessageProcessor } from './inbound-message.processor';
import { WhatsAppMessage, WhatsAppMessageSchema } from './schemas/whatsapp-message.schema';
import { WhatsAppSender, WhatsAppSenderSchema } from './schemas/whatsapp-sender.schema';
import { WhatsappInternalController } from './whatsapp-internal.controller';
import { WhatsappMessagesService } from './whatsapp-messages.service';
import { WhatsappSendersService } from './whatsapp-senders.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WhatsAppMessage.name, schema: WhatsAppMessageSchema },
      { name: WhatsAppSender.name, schema: WhatsAppSenderSchema },
    ]),
    GeminiModule,
    OrdersModule,
    PurchasesModule,
    CustomersModule,
    SuppliersModule,
  ],
  controllers: [WhatsappWebhookController, WhatsappInternalController],
  providers: [
    WhatsappMessagesService,
    WhatsappSendersService,
    InboundMessageProcessor,
  ],
})
export class WhatsappModule {}
