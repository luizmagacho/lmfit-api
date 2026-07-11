import {
  Controller, Get, Post, Patch, Delete, Param, Body, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { IntegrationsService } from './integrations.service';
import { SyncEngineService } from './sync-engine.service';
import { ProductMappingService } from './product-mapping.service';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { UpdateIntegrationDto } from './dto/update-integration.dto';
import { ConnectTiktokDto } from './dto/connect-tiktok.dto';

@Controller('integrations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class IntegrationsController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly syncEngine: SyncEngineService,
    private readonly mappingService: ProductMappingService,
  ) {}

  @Get()
  findAll(@TenantId() tenantId: string) {
    return this.integrationsService.findAll(tenantId);
  }

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateIntegrationDto) {
    return this.integrationsService.create(tenantId, dto);
  }

  /** Fluxo dedicado: troca o auth_code da autorização TikTok Shop e já cria a integração. */
  @Post('tiktok/connect')
  connectTiktok(@TenantId() tenantId: string, @Body() dto: ConnectTiktokDto) {
    return this.integrationsService.connectTiktok(tenantId, dto);
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.integrationsService.findOne(tenantId, id);
  }

  @Patch(':id')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateIntegrationDto) {
    return this.integrationsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  async remove(@TenantId() tenantId: string, @Param('id') id: string) {
    await this.mappingService.removeByIntegration(id);
    await this.integrationsService.remove(tenantId, id);
    return { deleted: true };
  }

  @Post(':id/test')
  testConnection(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.integrationsService.testConnection(tenantId, id);
  }

  @Post(':id/sync')
  sync(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.syncEngine.fullSync(tenantId, id);
  }

  @Get(':id/logs')
  async getLogs(@TenantId() tenantId: string, @Param('id') id: string) {
    await this.integrationsService.findOne(tenantId, id);
    return this.syncEngine.getSyncLogs(id);
  }

  @Get(':id/mappings')
  async getMappings(@TenantId() tenantId: string, @Param('id') id: string) {
    await this.integrationsService.findOne(tenantId, id);
    return this.mappingService.findAllByIntegration(id);
  }
}
