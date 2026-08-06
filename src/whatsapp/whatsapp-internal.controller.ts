import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CreateWhatsappSenderDto } from './dto/create-whatsapp-sender.dto';
import { SetConversationAiEnabledDto } from './dto/set-conversation-ai-enabled.dto';
import { UpdateWhatsappSenderDto } from './dto/update-whatsapp-sender.dto';
import { WhatsappConversationsService } from './whatsapp-conversations.service';
import { WhatsappMessagesService } from './whatsapp-messages.service';
import { WhatsappSendersService } from './whatsapp-senders.service';

@ApiTags('internal-whatsapp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('internal/whatsapp')
export class WhatsappInternalController {
  constructor(
    private readonly messages: WhatsappMessagesService,
    private readonly conversations: WhatsappConversationsService,
    private readonly senders: WhatsappSendersService,
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

  // Loop 12-B — cadastro de números de vendedores autorizados a vender por WhatsApp (voz/texto).
  // Só admin mexe: um número cadastrado aqui ganha o poder de criar vendas reais com baixa de
  // estoque, então quem pode ligar essa allowlist é mais restrito do que quem só lê o histórico.

  @Get('senders')
  listSenders(@TenantId() tenantId: string) {
    return this.senders.list(tenantId);
  }

  @Roles('admin')
  @Post('senders')
  createSender(@TenantId() tenantId: string, @Body() dto: CreateWhatsappSenderDto) {
    return this.senders.create(tenantId, dto);
  }

  @Roles('admin')
  @Patch('senders/:id')
  updateSender(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWhatsappSenderDto,
  ) {
    return this.senders.update(tenantId, id, dto);
  }

  @Roles('admin')
  @Delete('senders/:id')
  removeSender(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.senders.remove(tenantId, id);
  }
}
