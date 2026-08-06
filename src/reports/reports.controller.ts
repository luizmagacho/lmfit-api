import { Controller, Get, Query, UseGuards, Headers, BadRequestException } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TenantId } from '../common/decorators/tenant-id.decorator';
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
  summary(@TenantId() tenantId: string, @Query() q: ReportsQueryDto) {
    return this.reports.summary(tenantId, {
      from: new Date(q.from),
      to: new Date(q.to),
    });
  }

  @Get('sales-today')
  @ApiQuery({ name: 'date', required: false, description: 'ISO date (UTC day)' })
  salesToday(@TenantId() tenantId: string, @Query('date') date?: string) {
    return this.reports.salesToday(tenantId, date);
  }

  @Get('abc')
  abc(@TenantId() tenantId: string, @Query() q: ReportsQueryDto) {
    return this.reports.abc(tenantId, {
      from: new Date(q.from),
      to: new Date(q.to),
    });
  }

  /** Compras por dia. Datas em UTC. Inclui dias sem compras com purchaseCount=0. */

  @Get('sales-and-purchases-daily')
  salesAndPurchasesDaily(@TenantId() tenantId: string, @Query() q: ReportsQueryDto) {
    return this.reports.salesAndPurchasesDaily(tenantId, {
      from: new Date(q.from),
      to: new Date(q.to),
    });
  }

  @Get('purchases-daily')
  purchasesDaily(@TenantId() tenantId: string, @Query() q: ReportsQueryDto) {
    return this.reports.purchasesDaily(tenantId, {
      from: new Date(q.from),
      to: new Date(q.to),
    });
  }

  /** Receita por produto (top N). Receita = quantity × unitPrice; exclui frete/impostos. */
  @Get('revenue-by-product')
  revenueByProduct(@TenantId() tenantId: string, @Query() q: ReportsRevenueQueryDto) {
    return this.reports.revenueByProduct(
      tenantId,
      { from: new Date(q.from), to: new Date(q.to) },
      q.limit ?? 10,
    );
  }

  /** Vendas por influenciador (top N) — cruza `Order.couponCode` com `Promotion.influencerId`. */
  @Get('sales-by-influencer')
  salesByInfluencer(@TenantId() tenantId: string, @Query() q: ReportsRevenueQueryDto) {
    return this.reports.salesByInfluencer(
      tenantId,
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
    @TenantId() tenantId: string,
    @Query() q: ReportsQueryDto,
    @Query('taxRate') taxRate?: string,
  ) {
    const rate = taxRate ? parseFloat(taxRate) : 6;
    return this.reports.dre(
      tenantId,
      { from: new Date(q.from), to: new Date(q.to) },
      isNaN(rate) ? 6 : rate,
    );
  }
}
