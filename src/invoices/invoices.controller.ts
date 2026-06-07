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
import { FeatureGuard } from '../common/guards/feature.guard';
import { RequireFeature } from '../common/decorators/require-feature.decorator';
import { Feature } from '../common/enums/feature.enum';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../auth/jwt-user.payload';
import { ImportJsonDto } from '../common/dto/import-json.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceListQueryDto } from './dto/invoice-list-query.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { getInvoiceStatusOptionsPayload } from './invoice-status.i18n';
import { InvoicesService } from './invoices.service';

@ApiTags('invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, FeatureGuard)
@RequireFeature(Feature.INVOICES)
@Roles('admin', 'staff')
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post()
  create(
    @TenantId() tenantId: string,
    @Body() dto: CreateInvoiceDto,
    @CurrentUser() user: JwtUserPayload,
  ) {
    return this.invoices.create(tenantId, dto, user.sub);
  }

  @Get()
  findAll(@TenantId() tenantId: string, @Query() q: InvoiceListQueryDto) {
    return this.invoices.findAll(tenantId, q.page, q.limit, q.search, q.status);
  }

  @Get('export')
  async export(
    @TenantId() tenantId: string,
    @Query('format') format?: string,
    @Query('search') search?: string,
    @Query('status') status?: InvoiceListQueryDto['status'],
  ) {
    const fmt = (format ?? 'xlsx').toLowerCase();
    if (fmt !== 'xlsx' && fmt !== 'csv') {
      throw new BadRequestException({ message: 'format must be xlsx or csv' });
    }
    const { buffer, filename, mime } = await this.invoices.exportBuffer(
      tenantId,
      fmt as 'xlsx' | 'csv',
      search,
      status,
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
      return this.invoices.importFromJson(
        tenantId,
        b.items,
        b.dryRun ?? dryRun,
        user.sub,
      );
    }
    if (file?.buffer?.length) {
      return this.invoices.importFromXlsx(tenantId, file.buffer, dryRun, user.sub);
    }
    throw new BadRequestException({
      message:
        'Send JSON { "items": [...], "dryRun"?: boolean } or multipart field file',
    });
  }

  /** Labels and descriptions in pt-BR for invoice status (canonical API values). */
  @Get('status-options')
  invoiceStatusOptions() {
    return getInvoiceStatusOptionsPayload();
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.invoices.findOne(tenantId, id);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoices.update(tenantId, id, dto);
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.invoices.remove(tenantId, id);
  }
}
