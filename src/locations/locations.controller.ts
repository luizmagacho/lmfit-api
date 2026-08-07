import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { Audited } from '../audit/audited.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { TransferStockDto } from './dto/transfer-stock.dto';
import { AllocateStockDto } from './dto/allocate-stock.dto';
import { TransferBatchStockDto } from './dto/transfer-batch-stock.dto';

@ApiTags('locations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Audited('locations.create')
  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateLocationDto) {
    return this.locations.create(tenantId, dto);
  }

  @Get()
  findAll(@TenantId() tenantId: string) {
    return this.locations.findAll(tenantId);
  }

  /** Registered before the `:id` routes below — otherwise Nest would match "stock-matrix"
   *  as a location id. */
  @Get('stock-matrix')
  stockMatrix(@TenantId() tenantId: string) {
    return this.locations.stockMatrix(tenantId);
  }

  @Post('transfer')
  @Audited('locations.transfer')
  transfer(@TenantId() tenantId: string, @Body() dto: TransferStockDto) {
    return this.locations.transfer(tenantId, dto);
  }

  @Post('transfer-batch')
  @Audited('locations.transferBatch')
  transferBatch(@TenantId() tenantId: string, @Body() dto: TransferBatchStockDto) {
    return this.locations.transferBatch(tenantId, dto);
  }

  @Post('allocate')
  @Audited('locations.allocate')
  allocate(@TenantId() tenantId: string, @Body() dto: AllocateStockDto) {
    return this.locations.allocate(tenantId, dto);
  }

  @Roles('admin')
  @Post(':id/backfill-from-on-hand')
  @Audited('locations.backfillFromOnHand')
  backfillFromOnHand(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.locations.backfillFromOnHand(tenantId, id);
  }

  @Get('stock/:variantId')
  stockByVariant(@TenantId() tenantId: string, @Param('variantId') variantId: string) {
    return this.locations.listByVariant(tenantId, variantId);
  }

  @Get(':id/stock')
  stockByLocation(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Query() q: PaginationQueryDto,
  ) {
    return this.locations.stockByLocation(tenantId, id, q.page, q.limit);
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.locations.findOne(tenantId, id);
  }

  @Audited('locations.update')
  @Patch(':id')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.locations.update(tenantId, id, dto);
  }

  @Audited('locations.remove')
  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.locations.remove(tenantId, id);
  }
}
