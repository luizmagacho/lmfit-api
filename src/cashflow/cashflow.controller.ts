import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateCashflowImportDto } from './dto/create-cashflow-import.dto';
import { CashflowService } from './cashflow.service';

@ApiTags('cashflow')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('cashflow')
export class CashflowController {
  constructor(private readonly cashflow: CashflowService) {}

  /** Import a parsed InfinitePay batch */
  @Post('import')
  import(
    @Body() dto: CreateCashflowImportDto,
    @Req() req: Request & { user?: { sub?: string } },
  ) {
    const userId = req.user?.sub;
    return this.cashflow.importBatch(dto, userId);
  }

  /** List transactions */
  @Get()
  list(
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type') type?: string,
    @Query('importBatch') importBatch?: string,
  ) {
    return this.cashflow.findAll({
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
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.cashflow.summary(from, to);
  }

  /** List import batches */
  @Get('batches')
  batches() {
    return this.cashflow.listBatches();
  }

  /** Delete an entire import batch */
  @Delete('batches/:batchId')
  removeBatch(@Param('batchId') batchId: string) {
    return this.cashflow.removeBatch(batchId);
  }

  /** Trigger AI analysis for a single entry */
  @Post(':id/analyze')
  analyzeOne(@Param('id') id: string) {
    return this.cashflow.analyzeEntry(id);
  }

  /** Trigger AI analysis for all entries of a batch */
  @Post('batches/:batchId/analyze')
  async analyzeBatch(@Param('batchId') batchId: string) {
    const { items } = await this.cashflow.findAll({
      page: 1,
      limit: 500,
      importBatch: batchId,
    });
    const ids = items.map((i) => String(i._id));
    void this.cashflow.analyzeEntireBatch(batchId, ids);
    return { message: `Análise IA iniciada para ${ids.length} transações`, batchId };
  }
}
