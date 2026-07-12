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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { CreateTenantRequestDto } from './dto/create-tenant-request.dto';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { UpdateFiscalConfigDto } from './dto/update-fiscal-config.dto';
import { UpdateLoyaltyConfigDto } from './dto/update-loyalty-config.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { TenantsService } from './tenants.service';

import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';
import { Audited } from '../audit/audited.decorator';

/* ------------------------------------------------------------------ */
/*  Protected routes (admin only)                                     */
/* ------------------------------------------------------------------ */

@ApiTags('tenants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('tenants')
@SkipSubscriptionCheck()
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Audited('tenants.create')
  @Post()
  create(@Body() dto: CreateTenantDto) {
    return this.tenants.create(dto);
  }

  @Get()
  findAll(@Query() q: PaginationQueryDto) {
    return this.tenants.list(q.page, q.limit, q.search);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tenants.findById(id);
  }

  @Audited('tenants.update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenants.update(id, dto);
  }

  @Audited('tenants.updateBranding')
  @Patch(':id/branding')
  updateBranding(@Param('id') id: string, @Body() dto: UpdateBrandingDto) {
    return this.tenants.updateBranding(id, dto);
  }

  @Audited('tenants.updateFiscalConfig')
  @Patch(':id/fiscal')
  updateFiscalConfig(@Param('id') id: string, @Body() dto: UpdateFiscalConfigDto) {
    return this.tenants.updateFiscalConfig(id, dto);
  }

  @Audited('tenants.updateLoyaltyConfig')
  @Patch(':id/loyalty')
  updateLoyaltyConfig(@Param('id') id: string, @Body() dto: UpdateLoyaltyConfigDto) {
    return this.tenants.updateLoyaltyConfig(id, dto);
  }

  @Audited('tenants.softDelete')
  @Delete(':id')
  async softDelete(@Param('id') id: string) {
    await this.tenants.update(id, { active: false });
    return { message: 'Tenant deactivated' };
  }
}

/* ------------------------------------------------------------------ */
/*  Public routes (no auth)                                           */
/* ------------------------------------------------------------------ */

@ApiTags('tenants')
@Controller('public/tenants')
export class PublicTenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  listPublicActive() {
    return this.tenants.listPublicActive();
  }

  @Get(':slug')
  getPublicBranding(@Param('slug') slug: string) {
    return this.tenants.getPublicBranding(slug);
  }

  @Post('request')
  createTenantRequest(@Body() dto: CreateTenantRequestDto) {
    return this.tenants.createTenantRequest(dto);
  }
}
