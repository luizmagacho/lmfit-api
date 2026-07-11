import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../auth/jwt-user.payload';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Audited } from '../audit/audited.decorator';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';
import { ValidatePromotionDto } from './dto/validate-promotion.dto';
import { PromotionsService } from './promotions.service';

@ApiTags('promotions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Post()
  @Roles('admin')
  @Audited('promotions.create')
  create(
    @TenantId() tenantId: string,
    @Body() dto: CreatePromotionDto,
    @CurrentUser() user: JwtUserPayload,
  ) {
    return this.promotions.create(tenantId, dto, user.sub);
  }

  /**
   * Valida um cupom contra o subtotal atual e retorna o desconto calculado —
   * sem confirmar o uso (isso só acontece quando o pedido é de fato criado).
   * Usado pelo botão "Aplicar cupom" no editor de pedido do admin.
   */
  @Post('validate')
  validate(@TenantId() tenantId: string, @Body() dto: ValidatePromotionDto) {
    return this.promotions.validateAndComputeDiscount(tenantId, dto.code, dto.subtotal);
  }

  @Get()
  findAll(@TenantId() tenantId: string, @Query() q: PaginationQueryDto) {
    return this.promotions.findAll(tenantId, q.page, q.limit);
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.promotions.findOne(tenantId, id);
  }

  @Patch(':id')
  @Roles('admin')
  @Audited('promotions.update')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdatePromotionDto) {
    return this.promotions.update(tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  @Audited('promotions.remove')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.promotions.remove(tenantId, id);
  }
}
