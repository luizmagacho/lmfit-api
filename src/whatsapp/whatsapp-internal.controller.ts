import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { SetConversationAiEnabledDto } from './dto/set-conversation-ai-enabled.dto';
import { WhatsappConversationsService } from './whatsapp-conversations.service';
import { WhatsappMessagesService } from './whatsapp-messages.service';

@ApiTags('internal-whatsapp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('internal/whatsapp')
export class WhatsappInternalController {
  constructor(
    private readonly messages: WhatsappMessagesService,
    private readonly conversations: WhatsappConversationsService,
  ) {}

  @Get('messages')
  list(@Query() q: PaginationQueryDto) {
    return this.messages.listAll(q.page, q.limit);
  }

  @Get('escalations')
  escalations(@Query() q: PaginationQueryDto) {
    return this.messages.listEscalations(q.page, q.limit);
  }

  /** Loop 11-C — "humano assume a conversa": staff liga/desliga a IA pra um número específico
   *  sem precisar desligar `Tenant.whatsappAiEnabled` pra loja inteira. */
  @Patch('conversations/:waId')
  setAiEnabled(
    @TenantId() tenantId: string,
    @Param('waId') waId: string,
    @Body() dto: SetConversationAiEnabledDto,
  ) {
    return this.conversations.setAiEnabled(tenantId, waId, dto.aiEnabled);
  }
}
