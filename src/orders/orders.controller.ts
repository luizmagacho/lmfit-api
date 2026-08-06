import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ImportJsonDto } from '../common/dto/import-json.dto';
import { Audited } from '../audit/audited.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { LocationId } from '../common/decorators/location-id.decorator';
import type { JwtUserPayload } from '../auth/jwt-user.payload';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderListQueryDto } from './dto/order-list-query.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { SyncBatchDto } from './dto/sync-batch.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @Audited('orders.create')
  create(
    @TenantId() tenantId: string,
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: JwtUserPayload,
    @LocationId() locationId?: string,
  ) {
    // Presencial: o local vem sempre do operador autenticado (nunca do corpo da requisição,
    // que poderia ser adulterado) — só cai no local padrão do tenant se o operador não tiver
    // um local atribuído ainda.
    const resolved = dto.channel === 'in_person' && locationId ? { ...dto, locationId } : dto;
    return this.orders.create(tenantId, resolved, user.sub);
  }

  @Post('sync-batch')
  @Audited('orders.sync-batch')
  syncBatch(
    @TenantId() tenantId: string,
    @Body() dto: SyncBatchDto,
    @CurrentUser() user: JwtUserPayload,
    @LocationId() locationId?: string,
  ) {
    return this.orders.syncBatch(tenantId, locationId, dto.sales, user.sub);
  }

  @Get()
  findAll(@TenantId() tenantId: string, @Query() q: OrderListQueryDto) {
    return this.orders.findAll(tenantId, q.page, q.limit, q.search, q.channel);
  }

  @Get('export')
  async export(
    @TenantId() tenantId: string,
    @Query('format') format?: string,
    @Query('search') search?: string,
    @Query('channel') channel?: string,
  ) {
    const fmt = (format ?? 'xlsx').toLowerCase();
    if (fmt !== 'xlsx' && fmt !== 'csv') {
      throw new BadRequestException({ message: 'format must be xlsx or csv' });
    }
    const { buffer, filename, mime } = await this.orders.exportBuffer(
      tenantId,
      fmt as 'xlsx' | 'csv',
      search,
      channel,
    );
    return new StreamableFile(buffer, {
      type: mime,
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Post('import')
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }),
  )
  async importStaff(
    @TenantId() tenantId: string,
    @Req() req: Request,
    @CurrentUser() user: JwtUserPayload,
    @Body() body: ImportJsonDto | Record<string, never>,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Query('dryRun') dryRunQ?: string,
  ) {
    const dryRun = dryRunQ === 'true' || dryRunQ === '1';
    const ct = req.headers['content-type'] ?? '';
    if (ct.includes('application/json')) {
      const b = body as ImportJsonDto;
      if (!b?.items || !Array.isArray(b.items)) {
        throw new BadRequestException({
          message: 'JSON body must include items[]',
        });
      }
      return this.orders.importFromJson(tenantId, b.items, b.dryRun ?? dryRun, user.sub);
    }
    if (file?.buffer?.length) {
      return this.orders.importFromXlsx(tenantId, file.buffer, dryRun, user.sub);
    }
    throw new BadRequestException({
      message:
        'Send JSON { "items": [...], "dryRun"?: boolean } or multipart field file',
    });
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.orders.findOne(tenantId, id);
  }

  @Patch(':id')
  @Audited('orders.update')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateOrderDto,
    @CurrentUser() user: JwtUserPayload,
  ) {
    return this.orders.update(tenantId, id, dto, user.sub);
  }

  @Delete(':id')
  @Audited('orders.remove')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.orders.remove(tenantId, id);
  }
}
