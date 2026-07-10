import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { FeatureGuard } from '../common/guards/feature.guard';
import { RequireFeature } from '../common/decorators/require-feature.decorator';
import { Feature } from '../common/enums/feature.enum';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CreateCashflowImportDto } from './dto/create-cashflow-import.dto';
import { CreateCashflowEntryDto } from './dto/create-cashflow-entry.dto';
import { UpdateCashflowEntryDto } from './dto/update-cashflow-entry.dto';
import { CashflowService } from './cashflow.service';
import { LlmService } from '../llm/llm.service';

@ApiTags('cashflow')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, FeatureGuard)
@RequireFeature(Feature.FINANCIAL)
@Roles('admin', 'staff')
@Controller('cashflow')
export class CashflowController {
  constructor(
    private readonly cashflow: CashflowService,
    private readonly llm: LlmService,
  ) {}

  /** Import a parsed InfinitePay batch using AI */
  @Post('import/ai/parse')
  async parseAi(
    @Body() body: { text: string; periodFrom?: string; periodTo?: string; cnpj?: string; companyName?: string },
  ) {
    const transactions = await this.llm.parseInfinitePayPdf(body.text);
    return {
      periodFrom: body.periodFrom,
      periodTo: body.periodTo,
      cnpj: body.cnpj,
      companyName: body.companyName,
      transactions,
    };
  }

  /** Import a parsed InfinitePay batch */
  @Post('import')
  import(
    @TenantId() tenantId: string,
    @Body() dto: CreateCashflowImportDto,
    @Req() req: Request & { user?: { sub?: string } },
  ) {
    const userId = req.user?.sub;
    return this.cashflow.importBatch(tenantId, dto, userId);
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @Body() dto: CreateCashflowEntryDto,
    @Req() req: Request & { user?: { sub?: string } },
  ) {
    const userId = req.user?.sub;
    return this.cashflow.createEntry(tenantId, dto, userId);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCashflowEntryDto,
  ) {
    return this.cashflow.updateEntry(tenantId, id, dto);
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.cashflow.removeEntry(tenantId, id);
  }

  /** List transactions */
  @Get()
  list(
    @TenantId() tenantId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type') type?: string,
    @Query('importBatch') importBatch?: string,
  ) {
    return this.cashflow.findAll(tenantId, {
      page: Math.max(1, Number(page)),
      limit: Math.min(200, Math.max(1, Number(limit))),
      from,
      to,
      type,
      importBatch,
    });
  }

  /** Aggregated KPIs for a date range */
  @Get('summary')
  summary(
    @TenantId() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.cashflow.summary(tenantId, from, to);
  }

  /** List import batches */
  @Get('batches')
  batches(@TenantId() tenantId: string) {
    return this.cashflow.listBatches(tenantId);
  }

  /** Delete an entire import batch */
  @Delete('batches/:batchId')
  removeBatch(@TenantId() tenantId: string, @Param('batchId') batchId: string) {
    return this.cashflow.removeBatch(tenantId, batchId);
  }

  /** Trigger AI analysis for a single entry */
  @Post(':id/analyze')
  analyzeOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.cashflow.analyzeEntry(tenantId, id);
  }

  /** Trigger AI analysis for all entries of a batch */
  @Post('batches/:batchId/analyze')
  async analyzeBatch(@TenantId() tenantId: string, @Param('batchId') batchId: string) {
    const { items } = await this.cashflow.findAll(tenantId, {
      page: 1,
      limit: 500,
      importBatch: batchId,
    });
    const ids = items.map((i) => String(i._id));
    void this.cashflow.analyzeEntireBatch(tenantId, batchId, ids);
    return { message: `Análise IA iniciada para ${ids.length} transações`, batchId };
  }
}
