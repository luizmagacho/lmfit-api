import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CatalogModule } from '../catalog/catalog.module';
import { ChatModule } from '../chat/chat.module';
import { CustomersModule } from '../customers/customers.module';
import { LlmModule } from '../llm/llm.module';
import { OrderDraftsModule } from '../order-drafts/order-drafts.module';
import { OrdersModule } from '../orders/orders.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { TenantsModule } from '../tenants/tenants.module';
import { UsersModule } from '../users/users.module';
import { InboundMessageProcessor } from './inbound-message.processor';
import { WhatsAppMessage, WhatsAppMessageSchema } from './schemas/whatsapp-message.schema';
import { WhatsAppSender, WhatsAppSenderSchema } from './schemas/whatsapp-sender.schema';
import { WhatsappConversation, WhatsappConversationSchema } from './schemas/whatsapp-conversation.schema';
import { WhatsappChatService } from './whatsapp-chat.service';
import { WhatsappConversationsService } from './whatsapp-conversations.service';
import { WhatsappInternalController } from './whatsapp-internal.controller';
import { WhatsappMediaService } from './whatsapp-media.service';
import { WhatsappMessagesService } from './whatsapp-messages.service';
import { WhatsappSendersService } from './whatsapp-senders.service';
import { WhatsappSenderService } from './whatsapp-sender.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WhatsAppMessage.name, schema: WhatsAppMessageSchema },
      { name: WhatsAppSender.name, schema: WhatsAppSenderSchema },
      { name: WhatsappConversation.name, schema: WhatsappConversationSchema },
    ]),
    LlmModule,
    ChatModule,
    OrdersModule,
    OrderDraftsModule,
    PurchasesModule,
    CustomersModule,
    SuppliersModule,
    TenantsModule,
    CatalogModule,
    UsersModule,
  ],
  controllers: [WhatsappWebhookController, WhatsappInternalController],
  providers: [
    WhatsappMessagesService,
    WhatsappSendersService,
    WhatsappSenderService,
    WhatsappMediaService,
    WhatsappConversationsService,
    WhatsappChatService,
    InboundMessageProcessor,
  ],
  exports: [WhatsappSenderService],
})
export class WhatsappModule {}
