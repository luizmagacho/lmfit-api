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
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ImportJsonDto } from '../common/dto/import-json.dto';
import { CreateStaffOrderDraftDto } from './dto/staff-order-draft.dto';
import { StaffPatchOrderDraftDto } from './dto/staff-order-draft.dto';
import { OrderDraftsService } from './order-drafts.service';

@ApiTags('order-drafts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('order-drafts')
export class OrderDraftsController {
  constructor(private readonly drafts: OrderDraftsService) {}

  @Post()
  create(@Body() dto: CreateStaffOrderDraftDto) {
    return this.drafts.createPublic(dto);
  }

  @Get()
  list(@Query() q: PaginationQueryDto) {
    return this.drafts.listForStaff(q.page, q.limit);
  }

  @Get('export')
  async export(@Query('format') format?: string) {
    const fmt = (format ?? 'xlsx').toLowerCase();
    if (fmt !== 'xlsx' && fmt !== 'csv') {
      throw new BadRequestException({ message: 'format must be xlsx or csv' });
    }
    const { buffer, filename, mime } = await this.drafts.exportDraftsBuffer(
      fmt as 'xlsx' | 'csv',
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
    @Req() req: Request,
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
      return this.drafts.importDraftsFromJson(b.items, b.dryRun ?? dryRun);
    }
    if (file?.buffer?.length) {
      return this.drafts.importDraftsFromXlsx(file.buffer, dryRun);
    }
    throw new BadRequestException({
      message:
        'Send JSON { "items": [...], "dryRun"?: boolean } or multipart field file',
    });
  }

  /** `:id` is the draft `sessionToken` (URL-encode if needed). */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.drafts.getByToken(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: StaffPatchOrderDraftDto) {
    return this.drafts.patchForStaff(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.drafts.removeByTokenForStaff(id);
  }
}
