import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { FeatureGuard } from '../common/guards/feature.guard';
import { RequireFeature } from '../common/decorators/require-feature.decorator';
import { Feature } from '../common/enums/feature.enum';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ProductionService } from './production.service';
import { CreateProductionBatchDto } from './dto/create-production-batch.dto';
import { UpdateProductionBatchDto } from './dto/update-production-batch.dto';

@ApiTags('production')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, FeatureGuard)
@RequireFeature(Feature.PRODUCTION)
@Roles('admin', 'staff')
@Controller('production')
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @Post('batches')
  create(@TenantId() tenantId: string, @Body() dto: CreateProductionBatchDto) {
    return this.production.create(tenantId, dto);
  }

  @Get('batches')
  @ApiQuery({ name: 'status', required: false })
  findAll(
    @TenantId() tenantId: string,
    @Query() q: PaginationQueryDto,
    @Query('status') status?: string,
  ) {
    return this.production.findAll(tenantId, q.page, q.limit, q.search, status);
  }

  /** Retorna lotes agrupados por status — para o Kanban */
  @Get('batches/kanban')
  findKanban(@TenantId() tenantId: string) {
    return this.production.findKanban(tenantId);
  }

  /** Lista todos os status distintos (colunas do Kanban) */
  @Get('batches/statuses')
  getStatuses(@TenantId() tenantId: string) {
    return this.production.getDistinctStatuses(tenantId);
  }

  @Get('batches/:id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.production.findOne(tenantId, id);
  }

  @Patch('batches/:id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductionBatchDto,
  ) {
    return this.production.update(tenantId, id, dto);
  }

  @Delete('batches/:id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.production.remove(tenantId, id);
  }

  /** Resumo CMV para DRE */
  @Get('cmv-summary')
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  cmvSummary(
    @TenantId() tenantId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.production.getCmvSummary(tenantId, new Date(from), new Date(to));
  }
}
