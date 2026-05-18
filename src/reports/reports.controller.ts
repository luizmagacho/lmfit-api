import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ReportsService } from './reports.service';
import { ReportsQueryDto } from './dto/reports-query.dto';
import { ReportsRevenueQueryDto } from './dto/reports-revenue-query.dto';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  summary(@Query() q: ReportsQueryDto) {
    return this.reports.summary({
      from: new Date(q.from),
      to: new Date(q.to),
    });
  }

  @Get('sales-today')
  @ApiQuery({ name: 'date', required: false, description: 'ISO date (UTC day)' })
  salesToday(@Query('date') date?: string) {
    return this.reports.salesToday(date);
  }

  @Get('abc')
  abc(@Query() q: ReportsQueryDto) {
    return this.reports.abc({
      from: new Date(q.from),
      to: new Date(q.to),
    });
  }

  /** Compras por dia. Datas em UTC. Inclui dias sem compras com purchaseCount=0. */
  @Get('purchases-daily')
  purchasesDaily(@Query() q: ReportsQueryDto) {
    return this.reports.purchasesDaily({
      from: new Date(q.from),
      to: new Date(q.to),
    });
  }

  /** Receita por produto (top N). Receita = quantity × unitPrice; exclui frete/impostos. */
  @Get('revenue-by-product')
  revenueByProduct(@Query() q: ReportsRevenueQueryDto) {
    return this.reports.revenueByProduct(
      { from: new Date(q.from), to: new Date(q.to) },
      q.limit ?? 10,
    );
  }

  /**
   * DRE Simplificado — Faturamento, Lucro Bruto, Lucro Líquido.
   * @param taxRate Percentual de imposto (Simples Nacional). Padrão: 6.
   */
  @Get('dre')
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiQuery({ name: 'taxRate', required: false, description: 'Percentual de imposto (%). Ex: 6 para Simples Nacional' })
  dre(
    @Query() q: ReportsQueryDto,
    @Query('taxRate') taxRate?: string,
  ) {
    const rate = taxRate ? parseFloat(taxRate) : 6;
    return this.reports.dre(
      { from: new Date(q.from), to: new Date(q.to) },
      isNaN(rate) ? 6 : rate,
    );
  }
}
