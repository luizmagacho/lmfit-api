import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { Audited } from '../audit/audited.decorator';
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { TransferStockDto } from './dto/transfer-stock.dto';

@ApiTags('locations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateLocationDto) {
    return this.locations.create(tenantId, dto);
  }

  @Get()
  findAll(@TenantId() tenantId: string) {
    return this.locations.findAll(tenantId);
  }

  @Post('transfer')
  @Audited('locations.transfer')
  transfer(@TenantId() tenantId: string, @Body() dto: TransferStockDto) {
    return this.locations.transfer(tenantId, dto);
  }

  @Get('stock/:variantId')
  stockByVariant(@TenantId() tenantId: string, @Param('variantId') variantId: string) {
    return this.locations.listByVariant(tenantId, variantId);
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.locations.findOne(tenantId, id);
  }

  @Patch(':id')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.locations.update(tenantId, id, dto);
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.locations.remove(tenantId, id);
  }
}
