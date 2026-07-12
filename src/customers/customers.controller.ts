import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
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
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ImportJsonDto } from '../common/dto/import-json.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import type { JwtUserPayload } from '../auth/jwt-user.payload';
import { Audited } from '../audit/audited.decorator';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Audited('customers.create')
  @Post()
  create(
    @Body() dto: CreateCustomerDto,
    @CurrentUser() user: JwtUserPayload,
    @TenantId() tenantId: string,
  ) {
    return this.customers.create(tenantId, dto, user.sub);
  }

  @Get()
  findAll(
    @Query() q: PaginationQueryDto,
    @TenantId() tenantId: string,
  ) {
    return this.customers.findAll(tenantId, q.page, q.limit, q.search);
  }

  @Get('export')
  async export(
    @Query('format') format: string | undefined,
    @Query('search') search: string | undefined,
    @TenantId() tenantId: string,
  ) {
    const fmt = (format ?? 'xlsx').toLowerCase();
    if (fmt !== 'xlsx' && fmt !== 'csv') {
      throw new BadRequestException({
        message: 'format must be xlsx or csv',
      });
    }
    const { buffer, filename, mime } = await this.customers.exportBuffer(
      tenantId,
      fmt as 'xlsx' | 'csv',
      search,
    );
    return new StreamableFile(buffer, {
      type: mime,
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Audited('customers.import')
  @Post('import')
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }),
  )
  async importStaff(
    @Req() req: Request,
    @CurrentUser() user: JwtUserPayload,
    @TenantId() tenantId: string,
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
      return this.customers.importFromJson(
        tenantId,
        b.items,
        b.dryRun ?? dryRun,
        user.sub,
      );
    }
    if (file?.buffer?.length) {
      return this.customers.importFromXlsx(tenantId, file.buffer, dryRun, user.sub);
    }
    throw new BadRequestException({
      message:
        'Send JSON { "items": [...], "dryRun"?: boolean } or multipart field file',
    });
  }

  @Get('by-wa/:waId')
  async findByWa(
    @Param('waId') waId: string,
    @TenantId() tenantId: string,
  ) {
    const doc = await this.customers.findByWaId(tenantId, waId);
    if (!doc) throw new NotFoundException();
    return doc;
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @TenantId() tenantId: string,
  ) {
    return this.customers.findOne(tenantId, id);
  }

  @Audited('customers.update')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @TenantId() tenantId: string,
  ) {
    return this.customers.update(tenantId, id, dto);
  }

  @Audited('customers.remove')
  @Delete(':id')
  remove(
    @Param('id') id: string,
    @TenantId() tenantId: string,
  ) {
    return this.customers.remove(tenantId, id);
  }
}
