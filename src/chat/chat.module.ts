import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { LlmModule } from '../llm/llm.module';
import { ChatService } from './chat.service';
import { PublicChatController } from './public-chat.controller';

@Module({
  imports: [CatalogModule, LlmModule],
  controllers: [PublicChatController],
  providers: [ChatService],
})
export class ChatModule {}
