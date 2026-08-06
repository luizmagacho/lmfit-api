import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order } from '../orders/schemas/order.schema';
import { Product } from '../products/schemas/product.schema';
import { ProductVariant } from '../products/schemas/product-variant.schema';
import { Purchase } from '../purchases/schemas/purchase.schema';
import { ProductionBatch } from '../production/schemas/production-batch.schema';
import { Promotion } from '../promotions/schemas/promotion.schema';
import { Influencer } from '../influencers/schemas/influencer.schema';

export type ReportsRange = { from: Date; to: Date };

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    @InjectModel(Product.name) private readonly productModel: Model<Product>,
    @InjectModel(ProductVariant.name)
    private readonly variantModel: Model<ProductVariant>,
    @InjectModel(Purchase.name) private readonly purchaseModel: Model<Purchase>,
    @InjectModel(ProductionBatch.name)
    private readonly batchModel: Model<ProductionBatch>,
    @InjectModel(Promotion.name) private readonly promotionModel: Model<Promotion>,
    @InjectModel(Influencer.name) private readonly influencerModel: Model<Influencer>,
  ) {}

  private utcDayRange(ref: Date): { from: Date; to: Date } {
    const from = new Date(
      Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 0, 0, 0, 0),
    );
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + 1);
    to.setUTCMilliseconds(to.getUTCMilliseconds() - 1);
    return { from, to };
  }

  /**
   * GET /reports/purchases-daily
   * Aggregates purchase orders by UTC calendar day.
   * Dates are UTC. Each point: { date: "YYYY-MM-DD", purchaseCount, totalAmount }.
   * Days with zero purchases are included in the output.
   */
  async purchasesDaily(tenantId: string, range: ReportsRange) {
    const rows = await this.purchaseModel
      .aggregate<{ date: string; purchaseCount: number; totalAmount: number }>([
        {
          $match: {
            tenantId: new Types.ObjectId(tenantId),
            createdAt: { $gte: range.from, $lte: range.to },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' },
            },
            purchaseCount: { $sum: 1 },
            totalAmount: { $sum: '$total' },
          },
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            _id: 0,
            date: '$_id',
            purchaseCount: 1,
            totalAmount: { $round: ['$totalAmount', 2] },
          },
        },
      ])
      .exec();

    // Fill gaps for days with 0 purchases
    const byDate = new Map(rows.map((r) => [r.date, r]));
    const points: Array<{ date: string; purchaseCount: number; totalAmount: number }> = [];
    const cursor = new Date(
      Date.UTC(
        range.from.getUTCFullYear(),
        range.from.getUTCMonth(),
        range.from.getUTCDate(),
      ),
    );
    const end = new Date(
      Date.UTC(
        range.to.getUTCFullYear(),
        range.to.getUTCMonth(),
        range.to.getUTCDate(),
      ),
    );
    while (cursor <= end) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const hit = byDate.get(dateStr);
      points.push(hit ?? { date: dateStr, purchaseCount: 0, totalAmount: 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      points,
    };
  }

  /**
   * GET /reports/revenue-by-product
   * Returns top N products by net line revenue (quantity × unitPrice) from paid/fulfilled orders.
   * Excludes taxes and shipping. Source: orders.lines.
   */

  async salesAndPurchasesDaily(tenantId: string, range: ReportsRange) {
    const purchaseRows = await this.purchaseModel
      .aggregate([
        { $match: { tenantId: new Types.ObjectId(tenantId), createdAt: { $gte: range.from, $lte: range.to } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
            purchaseCount: { $sum: 1 },
            totalPurchases: { $sum: '$total' },
          },
        },
      ])
      .exec();

    const salesRows = await this.orderModel
      .aggregate([
        { $match: { tenantId: new Types.ObjectId(tenantId), createdAt: { $gte: range.from, $lte: range.to }, status: 'completed' } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
            orderCount: { $sum: 1 },
            totalSales: { $sum: '$total' },
          },
        },
      ])
      .exec();

    const byDate = new Map();
    for (const r of purchaseRows) {
      byDate.set(r._id, { date: r._id, purchaseCount: r.purchaseCount, totalPurchases: Math.round(r.totalPurchases * 100) / 100, orderCount: 0, totalSales: 0 });
    }
    for (const r of salesRows) {
      if (!byDate.has(r._id)) {
        byDate.set(r._id, { date: r._id, purchaseCount: 0, totalPurchases: 0, orderCount: 0, totalSales: 0 });
      }
      const entry = byDate.get(r._id);
      entry.orderCount = r.orderCount;
      entry.totalSales = Math.round(r.totalSales * 100) / 100;
    }

    const points = [];
    const cursor = new Date(Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), range.from.getUTCDate()));
    const end = new Date(Date.UTC(range.to.getUTCFullYear(), range.to.getUTCMonth(), range.to.getUTCDate()));
    
    while (cursor <= end) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const hit = byDate.get(dateStr);
      points.push(hit ?? { date: dateStr, purchaseCount: 0, totalPurchases: 0, orderCount: 0, totalSales: 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      points,
    };
  }

  async revenueByProduct(tenantId: string, range: ReportsRange, limit = 10) {
    const matchPaid = {
      tenantId: new Types.ObjectId(tenantId),
      createdAt: { $gte: range.from, $lte: range.to },
      status: { $in: ['completed'] as const },
    };
    const rows = await this.orderModel
      .aggregate<{ _id: Types.ObjectId; revenue: number; units: number }>([
        { $match: matchPaid },
        { $unwind: '$lines' },
        {
          $lookup: {
            from: 'productvariants',
            localField: 'lines.variantId',
            foreignField: '_id',
            as: 'v',
          },
        },
        { $unwind: '$v' },
        {
          $group: {
            _id: '$v.productId',
            revenue: { $sum: { $multiply: ['$lines.quantity', '$lines.unitPrice'] } },
            units: { $sum: '$lines.quantity' },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: limit },
      ])
      .exec();

    const items = await Promise.all(
      rows.map(async (r) => {
        const prod = await this.productModel
          .findOne({ _id: r._id, tenantId: new Types.ObjectId(tenantId) })
          .select({ name: 1 })
          .lean()
          .exec();
        const firstVar = await this.variantModel
          .findOne({ productId: r._id, tenantId: new Types.ObjectId(tenantId) })
          .sort({ sku: 1 })
          .select({ sku: 1 })
          .lean()
          .exec();
        return {
          productId: String(r._id),
          name: (prod as { name?: string } | null)?.name ?? '(sem nome)',
          sku: (firstVar as { sku?: string } | null)?.sku ?? '',
          revenue: Math.round(r.revenue * 100) / 100,
          units: r.units,
        };
      }),
    );

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      items,
    };
  }

  /**
   * GET /reports/sales-by-influencer
   * Vendas atribuídas por influenciador (Programa de Influenciadores) — cruza `Order.couponCode`
   * (string denormalizada, `Order` não guarda `promotionId`) com `Promotion.influencerId`.
   * Receita = quantity × unitPrice (mesma definição de `revenueByProduct`, não `order.total`, que
   * já embute o desconto do próprio cupom). Pedidos cujo cupom não tem mais promoção
   * correspondente (excluída) ou cuja promoção não tem influenciador (cupom comum) são excluídos
   * do agrupamento, não quebram a agregação.
   */
  async salesByInfluencer(tenantId: string, range: ReportsRange, limit = 10) {
    const tenantObjectId = new Types.ObjectId(tenantId);
    const rows = await this.orderModel
      .aggregate<{ _id: Types.ObjectId; revenue: number; units: number; orderCount: number }>([
        {
          $match: {
            tenantId: tenantObjectId,
            createdAt: { $gte: range.from, $lte: range.to },
            status: { $in: ['completed'] as const },
            couponCode: { $exists: true, $ne: null },
          },
        },
        {
          $lookup: {
            from: 'promotions',
            let: { code: '$couponCode' },
            pipeline: [
              {
                $match: {
                  $expr: { $and: [{ $eq: ['$tenantId', tenantObjectId] }, { $eq: ['$code', '$$code'] }] },
                },
              },
            ],
            as: 'promo',
          },
        },
        // Cupom cuja promoção foi excluída desde a venda: some do agrupamento em vez de quebrar.
        { $unwind: { path: '$promo', preserveNullAndEmptyArrays: false } },
        // Cupom comum (sem influenciador vinculado) não entra neste relatório.
        { $match: { 'promo.influencerId': { $exists: true, $ne: null } } },
        { $unwind: '$lines' },
        {
          $group: {
            _id: '$promo.influencerId',
            revenue: { $sum: { $multiply: ['$lines.quantity', '$lines.unitPrice'] } },
            units: { $sum: '$lines.quantity' },
            orderIds: { $addToSet: '$_id' },
          },
        },
        {
          $project: {
            _id: 1,
            revenue: 1,
            units: 1,
            orderCount: { $size: '$orderIds' },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: limit },
      ])
      .exec();

    const items = await Promise.all(
      rows.map(async (r) => {
        const influencer = await this.influencerModel
          .findOne({ _id: r._id, tenantId: tenantObjectId })
          .select({ name: 1 })
          .lean()
          .exec();
        return {
          influencerId: String(r._id),
          name: (influencer as { name?: string } | null)?.name ?? '(influenciador removido)',
          revenue: Math.round(r.revenue * 100) / 100,
          units: r.units,
          orderCount: r.orderCount,
        };
      }),
    );

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      items,
    };
  }

  async salesToday(tenantId: string, dateStr?: string) {
    const ref = dateStr ? new Date(dateStr) : new Date();
    if (Number.isNaN(ref.getTime())) {
      throw new BadRequestException('Data inválida');
    }
    const { from, to } = this.utcDayRange(ref);
    const matchPaid = {
      tenantId: new Types.ObjectId(tenantId),
      createdAt: { $gte: from, $lte: to },
      status: { $in: ['completed'] as const },
    };
    const [agg] = await this.orderModel
      .aggregate<{ total: number; count: number }>([
        { $match: matchPaid },
        {
          $group: {
            _id: null,
            total: { $sum: '$total' },
            count: { $sum: 1 },
          },
        },
      ])
      .exec();
    const total = agg?.total ?? 0;
    const orderCount = agg?.count ?? 0;
    const avgTicket = orderCount > 0 ? Math.round((total / orderCount) * 100) / 100 : 0;
    return {
      date: from.toISOString().slice(0, 10),
      total,
      orderCount,
      avgTicket,
    };
  }

  async abc(tenantId: string, range: ReportsRange) {
    const matchPaid = {
      tenantId: new Types.ObjectId(tenantId),
      createdAt: { $gte: range.from, $lte: range.to },
      status: { $in: ['completed'] as const },
    };
    const rows = await this.orderModel
      .aggregate<{
        _id: Types.ObjectId;
        revenue: number;
        units: number;
      }>([
        { $match: matchPaid },
        { $unwind: '$lines' },
        {
          $lookup: {
            from: 'productvariants',
            localField: 'lines.variantId',
            foreignField: '_id',
            as: 'v',
          },
        },
        { $unwind: '$v' },
        {
          $group: {
            _id: '$v.productId',
            revenue: {
              $sum: {
                $multiply: ['$lines.quantity', '$lines.unitPrice'],
              },
            },
            units: { $sum: '$lines.quantity' },
          },
        },
        { $sort: { revenue: -1 } },
      ])
      .exec();

    const grand = rows.reduce((s, r) => s + r.revenue, 0) || 1;
    let cumulative = 0;
    const items: Array<{
      productId: string;
      name: string;
      sku: string;
      revenue: number;
      units: number;
      cumulativePercent: number;
      curve: 'A' | 'B' | 'C';
    }> = [];
    for (const r of rows) {
      cumulative += r.revenue;
      const cumulativePercent = Math.round((cumulative / grand) * 1000) / 10;
      const curve: 'A' | 'B' | 'C' =
        cumulativePercent <= 80 ? 'A' : cumulativePercent <= 95 ? 'B' : 'C';
      const prod = await this.productModel
        .findOne({ _id: r._id, tenantId: new Types.ObjectId(tenantId) })
        .select({ name: 1 })
        .lean()
        .exec();
      const firstVar = await this.variantModel
        .findOne({ productId: r._id, tenantId: new Types.ObjectId(tenantId) })
        .sort({ sku: 1 })
        .select({ sku: 1 })
        .lean()
        .exec();
      items.push({
        productId: String(r._id),
        name: (prod as { name?: string } | null)?.name ?? '(sem nome)',
        sku: (firstVar as { sku?: string } | null)?.sku ?? '',
        revenue: Math.round(r.revenue * 100) / 100,
        units: r.units,
        cumulativePercent,
        curve,
      });
    }
    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      items,
    };
  }

  async summary(tenantId: string, range: ReportsRange) {
    const matchPaid = {
      tenantId: new Types.ObjectId(tenantId),
      createdAt: { $gte: range.from, $lte: range.to },
      status: { $in: ['completed'] as const },
    };

    const [revenueAgg] = await this.orderModel
      .aggregate<{ total: number; count: number }>([
        { $match: matchPaid },
        {
          $group: {
            _id: null,
            total: { $sum: '$total' },
            count: { $sum: 1 },
          },
        },
      ])
      .exec();

    const topVariants = await this.orderModel
      .aggregate<{
        variantId: Types.ObjectId;
        units: number;
        revenue: number;
      }>([
        { $match: matchPaid },
        { $unwind: '$lines' },
        {
          $group: {
            _id: '$lines.variantId',
            units: { $sum: '$lines.quantity' },
            revenue: {
              $sum: {
                $multiply: ['$lines.quantity', '$lines.unitPrice'],
              },
            },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'productvariants',
            localField: '_id',
            foreignField: '_id',
            as: 'variant',
          },
        },
        { $unwind: { path: '$variant', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            variantId: '$_id',
            sku: '$variant.sku',
            color: '$variant.color',
            size: '$variant.size',
            units: 1,
            revenue: 1,
          },
        },
      ])
      .exec();

    const variants = await this.variantModel
      .find({ tenantId: new Types.ObjectId(tenantId) })
      .select({ sku: 1, quantityOnHand: 1, price: 1 })
      .lean()
      .exec();
    const stockValue = variants.reduce(
      (acc, v) => acc + (v.quantityOnHand ?? 0) * (v.price ?? 0),
      0,
    );

    const totalRev = revenueAgg?.total ?? 0;
    const orderCount = revenueAgg?.count ?? 0;
    const avgTicket =
      orderCount > 0 ? Math.round((totalRev / orderCount) * 100) / 100 : 0;
    const st = await this.salesToday(tenantId);
    const salesToday = st.total;

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      revenue: {
        total: totalRev,
        orderCount,
        source: 'orders_paid_or_fulfilled',
      },
      avgTicket,
      salesToday,
      topVariants,
      stockValue: { totalRetail: stockValue, note: 'quantityOnHand * variant.price' },
    };
  }

  /**
   * GET /reports/dre
   * DRE Simplificado (Demonstrativo de Resultado do Exercício).
   * Agrega: faturamento (orders), CMV (production batches), despesas (cashflow).
   */
  async dre(tenantId: string, range: ReportsRange, taxRatePercent = 6) {
    // ── 1. Faturamento Bruto (orders pagas/entregues) ──────────────────
    const matchPaid = {
      tenantId: new Types.ObjectId(tenantId),
      createdAt: { $gte: range.from, $lte: range.to },
      status: { $in: ['completed'] as const },
    };
    const [revAgg] = await this.orderModel
      .aggregate<{ total: number; count: number }>([
        { $match: matchPaid },
        { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
      ])
      .exec();

    const grossRevenue = revAgg?.total ?? 0;
    const orderCount = revAgg?.count ?? 0;

    // Devoluções/cancelamentos
    const [cancAgg] = await this.orderModel
      .aggregate<{ total: number; count: number }>([
        {
          $match: {
            tenantId: new Types.ObjectId(tenantId),
            createdAt: { $gte: range.from, $lte: range.to },
            status: 'cancelled',
          },
        },
        { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
      ])
      .exec();
    const returns = cancAgg?.total ?? 0;
    const netRevenue = grossRevenue - returns;

    // ── 2. CMV — soma dos custos totais dos lotes produzidos no período ──
    const [batchAgg] = await this.batchModel
      .aggregate<{ totalBatchCost: number; totalUnits: number; batchCount: number }>([
        {
          $match: {
            tenantId: new Types.ObjectId(tenantId),
            createdAt: { $gte: range.from, $lte: range.to },
          },
        },
        {
          $group: {
            _id: null,
            totalBatchCost: { $sum: '$totalBatchCost' },
            totalUnits: { $sum: '$batchQty' },
            batchCount: { $sum: 1 },
          },
        },
      ])
      .exec();
    const cmv = batchAgg?.totalBatchCost ?? 0;
    const producedUnits = batchAgg?.totalUnits ?? 0;
    const batchCount = batchAgg?.batchCount ?? 0;
    const avgCostPerUnit = producedUnits > 0 ? cmv / producedUnits : 0;

    const grossProfit = netRevenue - cmv;
    const grossMarginPercent = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;

    // ── 3. Despesas Operacionais (cashflow saídas manuais) ──────────────
    // Use a try-catch — cashflow collection might not exist
    let operationalExpenses = 0;
    let financialFees = 0;
    try {
      const db = this.orderModel.db;
      const cashflow = db.collection('cashflowentries');
      const [expAgg] = await cashflow
        .aggregate<{ total: number }>([
          {
            $match: {
              tenantId: new Types.ObjectId(tenantId),
              date: { $gte: range.from.toISOString(), $lte: range.to.toISOString() },
              amount: { $lt: 0 },
            },
          },
          { $group: { _id: null, total: { $sum: { $abs: '$amount' } } } },
        ])
        .toArray();
      const [feeAgg] = await cashflow
        .aggregate<{ total: number }>([
          {
            $match: {
              tenantId: new Types.ObjectId(tenantId),
              date: { $gte: range.from.toISOString(), $lte: range.to.toISOString() },
              type: { $in: ['pix_sent'] },
              amount: { $lt: 0 },
            },
          },
          { $group: { _id: null, total: { $sum: { $abs: '$amount' } } } },
        ])
        .toArray();
      operationalExpenses = (expAgg as { total?: number } | undefined)?.total ?? 0;
      financialFees = (feeAgg as { total?: number } | undefined)?.total ?? 0;
    } catch {
      // cashflow not available — values remain 0
    }

    const ebitda = grossProfit - operationalExpenses;
    const taxes = (netRevenue * taxRatePercent) / 100;
    const netProfit = ebitda - taxes;
    const netMarginPercent = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      taxRatePercent,
      revenue: {
        grossRevenue: Math.round(grossRevenue * 100) / 100,
        returns: Math.round(returns * 100) / 100,
        netRevenue: Math.round(netRevenue * 100) / 100,
        orderCount,
      },
      cmv: {
        total: Math.round(cmv * 100) / 100,
        producedUnits,
        batchCount,
        avgCostPerUnit: Math.round(avgCostPerUnit * 100) / 100,
      },
      grossProfit: Math.round(grossProfit * 100) / 100,
      grossMarginPercent: Math.round(grossMarginPercent * 10) / 10,
      operationalExpenses: Math.round(operationalExpenses * 100) / 100,
      financialFees: Math.round(financialFees * 100) / 100,
      ebitda: Math.round(ebitda * 100) / 100,
      taxes: Math.round(taxes * 100) / 100,
      netProfit: Math.round(netProfit * 100) / 100,
      netMarginPercent: Math.round(netMarginPercent * 10) / 10,
    };
  }
}
