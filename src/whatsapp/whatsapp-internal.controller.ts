import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { WhatsappMessagesService } from './whatsapp-messages.service';

@ApiTags('internal-whatsapp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('internal/whatsapp')
export class WhatsappInternalController {
  constructor(private readonly messages: WhatsappMessagesService) {}

  @Get('messages')
  list(@Query() q: PaginationQueryDto) {
    return this.messages.listAll(q.page, q.limit);
  }

  @Get('escalations')
  escalations(@Query() q: PaginationQueryDto) {
    return this.messages.listEscalations(q.page, q.limit);
  }
}
