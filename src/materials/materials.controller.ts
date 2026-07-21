import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { MaterialsService } from './materials.service';
import { CreateMaterialDto } from './dto/create-material.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';

@ApiTags('materials')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('materials')
export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

  @Post()
  create(
    @TenantId() tenantId: string,
    @Body() createMaterialDto: CreateMaterialDto,
  ) {
    return this.materialsService.create(tenantId, createMaterialDto);
  }

  @Get()
  findAll(@Query() q: PaginationQueryDto, @TenantId() tenantId: string) {
    return this.materialsService.findAll(tenantId, q.page, q.limit, q.search);
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.materialsService.findOne(tenantId, id);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() updateMaterialDto: UpdateMaterialDto,
  ) {
    return this.materialsService.update(tenantId, id, updateMaterialDto);
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.materialsService.remove(tenantId, id);
  }
}
