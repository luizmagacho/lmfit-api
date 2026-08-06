import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { LeadsModule } from '../leads/leads.module';
import { LlmModule } from '../llm/llm.module';
import { ChatService } from './chat.service';
import { PublicChatController } from './public-chat.controller';

@Module({
  imports: [CatalogModule, LlmModule, LeadsModule],
  controllers: [PublicChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
