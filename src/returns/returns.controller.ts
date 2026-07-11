import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../auth/jwt-user.payload';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Audited } from '../audit/audited.decorator';
import { CreateReturnDto } from './dto/create-return.dto';
import { ReturnsService } from './returns.service';

@ApiTags('returns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('orders/:orderId/returns')
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Post()
  @Audited('returns.create')
  create(
    @TenantId() tenantId: string,
    @Param('orderId') orderId: string,
    @Body() dto: CreateReturnDto,
    @CurrentUser() user: JwtUserPayload,
  ) {
    return this.returns.create(tenantId, orderId, dto, user.sub);
  }

  @Get()
  findAllForOrder(@TenantId() tenantId: string, @Param('orderId') orderId: string) {
    return this.returns.findAllForOrder(tenantId, orderId);
  }
}

/** Histórico de devoluções/trocas do tenant (tela de gestão). */
@ApiTags('returns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('returns')
export class ReturnsHistoryController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  findAll(@TenantId() tenantId: string, @Query() q: PaginationQueryDto) {
    return this.returns.findAll(tenantId, q.page, q.limit);
  }
}
