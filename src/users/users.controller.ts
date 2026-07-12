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
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Roles('admin', 'staff')
  @Get()
  async list(@Query() q: PaginationQueryDto, @TenantId() tenantId: string) {
    const { items, total } = await this.users.list(
      tenantId,
      (q.page - 1) * q.limit,
      q.limit,
      q.search,
    );
    return { items, total, page: q.page, limit: q.limit };
  }

  @Roles('admin', 'staff')
  @Get('export')
  async export(
    @Query('format') format: string | undefined,
    @Query('search') search: string | undefined,
    @TenantId() tenantId: string,
  ) {
    const fmt = (format ?? 'xlsx').toLowerCase();
    if (fmt !== 'xlsx' && fmt !== 'csv') {
      throw new BadRequestException({ message: 'format must be xlsx or csv' });
    }
    const { buffer, filename, mime } = await this.users.exportBuffer(
      tenantId,
      fmt as 'xlsx' | 'csv',
      search,
    );
    return new StreamableFile(buffer, {
      type: mime,
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Roles('admin')
  @Audited('users.import')
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
      return this.users.importFromJson(tenantId, b.items, b.dryRun ?? dryRun, user.sub);
    }
    if (file?.buffer?.length) {
      return this.users.importFromXlsx(tenantId, file.buffer, dryRun, user.sub);
    }
    throw new BadRequestException({
      message:
        'Send JSON { "items": [...], "dryRun"?: boolean } or multipart field file',
    });
  }

  @Roles('admin')
  @Audited('users.create')
  @Post()
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() user: JwtUserPayload,
    @TenantId() tenantId: string,
  ) {
    return this.users.create(tenantId, {
      email: dto.email,
      password: dto.password,
      name: dto.name,
      role: dto.role ?? 'staff',
      createdBy: user.sub,
    });
  }

  @Roles('admin', 'staff')
  @Get(':id')
  getOne(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.users.findByIdPublic(tenantId, id).then((u) => {
      if (!u) throw new NotFoundException();
      return u;
    });
  }

  @Roles('admin')
  @Audited('users.update')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @TenantId() tenantId: string,
  ) {
    return this.users.update(tenantId, id, dto);
  }

  @Roles('admin')
  @Audited('users.remove')
  @Delete(':id')
  remove(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.users.remove(tenantId, id);
  }
}
