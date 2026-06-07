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
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ImportJsonDto } from '../common/dto/import-json.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../auth/jwt-user.payload';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { PurchasesService } from './purchases.service';

@ApiTags('purchases')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, FeatureGuard)
@RequireFeature(Feature.FINANCIAL)
@Roles('admin', 'staff')
@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Post()
  create(
    @TenantId() tenantId: string,
    @Body() dto: CreatePurchaseDto,
    @CurrentUser() user: JwtUserPayload,
  ) {
    return this.purchases.create(tenantId, dto, user.sub);
  }

  @Get()
  findAll(@TenantId() tenantId: string, @Query() q: PaginationQueryDto) {
    return this.purchases.findAll(tenantId, q.page, q.limit, q.search);
  }

  @Get('export')
  async export(
    @TenantId() tenantId: string,
    @Query('format') format?: string,
    @Query('search') search?: string,
  ) {
    const fmt = (format ?? 'xlsx').toLowerCase();
    if (fmt !== 'xlsx' && fmt !== 'csv') {
      throw new BadRequestException({ message: 'format must be xlsx or csv' });
    }
    const { buffer, filename, mime } = await this.purchases.exportBuffer(
      tenantId,
      fmt as 'xlsx' | 'csv',
      search,
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
      return this.purchases.importFromJson(
        tenantId,
        b.items,
        b.dryRun ?? dryRun,
        user.sub,
      );
    }
    if (file?.buffer?.length) {
      return this.purchases.importFromXlsx(tenantId, file.buffer, dryRun, user.sub);
    }
    throw new BadRequestException({
      message:
        'Send JSON { "items": [...], "dryRun"?: boolean } or multipart field file',
    });
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.purchases.findOne(tenantId, id);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseDto,
  ) {
    return this.purchases.update(tenantId, id, dto);
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.purchases.remove(tenantId, id);
  }
}
