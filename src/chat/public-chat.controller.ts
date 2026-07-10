import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { TenantFeatures } from '../common/decorators/tenant-features.decorator';
import { ChatService } from './chat.service';
import { PublicChatDto } from './dto/public-chat.dto';

@ApiTags('public-chat')
@Controller('public/chat')
export class PublicChatController {
  constructor(private readonly chat: ChatService) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  reply(@TenantId() tenantId: string, @Body() dto: PublicChatDto, @TenantFeatures() features: string[]) {
    return this.chat.reply(tenantId, dto, features);
  }
}
