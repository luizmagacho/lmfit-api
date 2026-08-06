import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { FeatureGuard } from '../common/guards/feature.guard';
import { RequireFeature } from '../common/decorators/require-feature.decorator';
import { Feature } from '../common/enums/feature.enum';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaymentsService } from './payments.service';
import { PaymentWebhookDispatcherService } from './payment-webhook-dispatcher.service';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, FeatureGuard)
@RequireFeature(Feature.FINANCIAL)
@Roles('admin', 'staff')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly webhookDispatcher: PaymentWebhookDispatcherService,
  ) {}

  @Get()
  findAll(@TenantId() tenantId: string, @Query() q: PaginationQueryDto) {
    return this.payments.findAll(tenantId, q.page, q.limit);
  }

  // Loop 10 — DLQ visibility: `FailedWebhook` existed since retries were added but had zero reader
  // anywhere in the codebase. Listed here (before `:id`) so it's discoverable, not just repayable
  // by a known id via curl.
  @Get('failed-webhooks')
  listFailedWebhooks(@TenantId() tenantId: string) {
    return this.webhookDispatcher.listFailedWebhooks(tenantId);
  }

  @Post('failed-webhooks/:id/replay')
  replayFailedWebhook(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.webhookDispatcher.replayFailedWebhook(tenantId, id);
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.payments.findOne(tenantId, id);
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.payments.remove(tenantId, id);
  }
}
