import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { StaffImportResponse } from '../common/dto/staff-import.response';
import { ExcelSpreadsheetService } from '../common/excel/excel-spreadsheet.service';
import { skipFromPage } from '../common/dto/pagination-query.dto';
import { ProductsService } from '../products/products.service';
import { ProductVariant } from '../products/schemas/product-variant.schema';
import { PurchasesService } from '../purchases/purchases.service';
import type { CreateOrderDto } from './dto/create-order.dto';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { PromotionsService } from '../promotions/promotions.service';
import type { OrderLineInputDto } from './dto/order-line-input.dto';
import type { UpdateOrderDto } from './dto/update-order.dto';
import { ORDER_EXPORT_COLUMNS, orderImportHeaderAliases } from './order-excel.constants';
import { Order } from './schemas/order.schema';
import { ORDER_CHANNELS } from './types/order-channel';
import type { OrderWarning } from './types/order-warning';
import { PaymentsService } from '../payments/payments.service';
import { Payment } from '../payments/schemas/payment.schema';
import { Customer } from '../customers/schemas/customer.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { escapeRegex } from '../common/utils/text-search.util';
import { CountersService } from '../common/counters/counters.service';

const STOCK_APPLIED_STATUSES = ['shipped', 'completed'] as const;

function isStockAppliedStatus(s: string): boolean {
  return (STOCK_APPLIED_STATUSES as readonly string[]).includes(s);
}

export type OrderResponse = Record<string, unknown> & {
  _id: Types.ObjectId | string;
  warnings: OrderWarning[];
};

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name) private readonly model: Model<Order>,
    @InjectModel(ProductVariant.name)
    private readonly variantModel: Model<ProductVariant>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<Payment>,
    @InjectModel(Customer.name)
    private readonly customerModel: Model<Customer>,
    private readonly excel: ExcelSpreadsheetService,
    private readonly products: ProductsService,
    private readonly purchases: PurchasesService,
    private readonly loyalty: LoyaltyService,
    private readonly promotions: PromotionsService,
    private readonly notifications: NotificationsService,
    private readonly counters: CountersService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly payments: any,
  ) {}

  private assertLinesRequiredForStatus(status: string, lines: Order['lines']) {
    if (isStockAppliedStatus(status) && (!lines || lines.length === 0)) {
      throw new UnprocessableEntityException({
        message:
          'Pedido enviado ou concluído precisa de pelo menos uma linha com produto (variante).',
      });
    }
  }

  private assertDraftMayHaveEmptyLines(status: string, lines: Order['lines']) {
    if (status === 'open' || status === 'cancelled') return;
    if (!lines?.length) {
      throw new UnprocessableEntityException({
        message: 'Informe ao menos um item (linha) para este status de pedido.',
      });
    }
  }

  private assertLinesNotEditableWhenLocked(
    currentStatus: string,
    dto: UpdateOrderDto,
  ) {
    if (
      dto.lines !== undefined &&
      (currentStatus === 'picking' ||
        currentStatus === 'shipped' ||
        currentStatus === 'completed')
    ) {
      throw new UnprocessableEntityException({
        message:
          'Não é possível alterar itens de pedido em separação, enviado ou concluído. Cancele o pedido ou ajuste o estoque manualmente, se aplicável.',
      });
    }
  }

  private async resolveLines(
    tenantId: string,
    inputs?: OrderLineInputDto[],
  ): Promise<{ lines: Order['lines']; total: number }> {
    if (!inputs?.length) {
      return { lines: [], total: 0 };
    }
    for (const line of inputs) {
      if (!Types.ObjectId.isValid(line.variantId)) {
        throw new BadRequestException(`Variante inválida ${line.variantId}`);
      }
    }
    // Batch both lookups instead of two round-trips per line.
    const variantIds = inputs.map((l) => l.variantId);
    const variants = await this.variantModel
      .find({ _id: { $in: variantIds }, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    const variantById = new Map(variants.map((v) => [String(v._id), v]));
    const pricingByVariant = await this.products.getWholesalePricingBatch(tenantId, variantIds);

    const lines: Order['lines'] = [];
    let sum = 0;
    for (const line of inputs) {
      const v = variantById.get(line.variantId);
      if (!v) {
        throw new BadRequestException(`Variante não encontrada ${line.variantId}`);
      }
      const unitPrice = line.unitPrice;
      // Staff/PDV can type a custom unitPrice (manual discounts are legitimate), but if
      // that price sits at or below the variant's wholesale rate, the minimum wholesale
      // quantity must still be honored — otherwise atacado pricing could be granted to a
      // varejo-sized purchase just by typing the lower number. Mirrors the server-side
      // enforcement already done for the public checkout in order-drafts.service.ts.
      // Only applies when the variant actually HAS a wholesale discount configured
      // (priceWholesale < priceRetail) — getWholesalePricingBatch() falls back priceWholesale
      // to priceRetail when the merchant never set one, and without this guard every single-unit
      // retail sale of such a variant (the common case — most SKUs here have no atacado price
      // set) was rejected with this same "exige quantidade mínima" error, since unitPrice ==
      // priceRetail == priceWholesale always satisfied `unitPrice <= priceWholesale`.
      const pricing = pricingByVariant.get(line.variantId);
      if (
        pricing &&
        pricing.priceWholesale < pricing.priceRetail &&
        unitPrice <= pricing.priceWholesale &&
        line.quantity < pricing.minWholesaleQty
      ) {
        throw new BadRequestException(
          `Preço de atacado para ${v.sku} exige quantidade mínima de ${pricing.minWholesaleQty} (solicitado ${line.quantity}).`,
        );
      }
      sum += unitPrice * line.quantity;
      lines.push({
        variantId: new Types.ObjectId(line.variantId),
        quantity: line.quantity,
        unitPrice,
        productionPrice: line.productionPrice || 0,
        description: line.description,
        isOrder: line.isOrder || false,
      });
    }
    return { lines, total: sum };
  }

  private async loadVariantsByIds(
    tenantId: string,
    variantIds: Types.ObjectId[],
  ): Promise<Map<string, ProductVariant>> {
    const map = new Map<string, ProductVariant>();
    if (!variantIds.length) return map;
    const docs = await this.variantModel
      .find({ _id: { $in: variantIds }, tenantId: new Types.ObjectId(tenantId) })
      .lean()
      .exec();
    for (const d of docs) {
      map.set(String(d._id), d as unknown as ProductVariant);
    }
    return map;
  }

  private async buildWarnings(tenantId: string, lines: Order['lines']): Promise<OrderWarning[]> {
    const warnings: OrderWarning[] = [];
    if (!lines?.length) return warnings;
    const ids = [...new Set(lines.map((l) => l.variantId))];
    const variants = await this.loadVariantsByIds(tenantId, ids);
    const pendingMap = await this.purchases.sumPendingOutstandingByVariantIds(ids);

    for (const line of lines) {
      if ((line as any).isOrder) continue;

      const vid = String(line.variantId);
      const v = variants.get(vid);
      if (!v) continue;
      const onHand = v.quantityOnHand ?? 0;
      if (onHand < line.quantity) {
        const shortfall = line.quantity - onHand;
        warnings.push({
          variantId: vid,
          type: 'shortfall',
          messagePtBr: `Estoque insuficiente para a variante ${v.sku}: necessário ${line.quantity}, disponível ${onHand} (faltam ${shortfall}). Considere um pedido de compra ao fornecedor.`,
          suggestCreatePurchase: true,
          shortfall,
        });
      }
      const pend = pendingMap.get(vid) ?? 0;
      if (pend > 0) {
        warnings.push({
          variantId: vid,
          type: 'pending_purchase',
          messagePtBr: `Existe compra pendente ao fornecedor para ${v.sku} (${pend} unidade(s) ainda não recebidas). Verifique o pedido de compra ou aguarde o recebimento.`,
          suggestCreatePurchase: false,
          pendingPurchaseQty: pend,
        });
      }
    }
    return warnings;
  }

  private groupedQuantities(lines: Order['lines']): Map<string, number> {
    const m = new Map<string, number>();
    for (const line of lines) {
      if ((line as any).isOrder) continue;
      const k = String(line.variantId);
      m.set(k, (m.get(k) ?? 0) + line.quantity);
    }
    return m;
  }

  private async assertStockSufficientForPay(tenantId: string, lines: Order['lines']) {
    if (!lines.length) return;
    const ids = lines.map((l) => l.variantId);
    const variants = await this.loadVariantsByIds(tenantId, ids);
    const grouped = this.groupedQuantities(lines);
    const conflicts: Array<{
      variantId: string;
      sku: string;
      needed: number;
      available: number;
      messagePtBr: string;
    }> = [];

    for (const [variantId, needed] of grouped) {
      const v = variants.get(variantId);
      const sku = v?.sku ?? variantId;
      const available = v?.quantityOnHand ?? 0;
      if (needed > available) {
        conflicts.push({
          variantId,
          sku,
          needed,
          available,
          messagePtBr: `Estoque insuficiente para ${sku}: necessário ${needed}, disponível ${available}.`,
        });
      }
    }

    if (conflicts.length) {
      throw new UnprocessableEntityException({
        message: 'Não foi possível concluir: estoque insuficiente para marcar como pago/atendido.',
        conflicts,
      });
    }
  }

  private toResponse(doc: Record<string, unknown>, warnings: OrderWarning[]) {
    return { ...doc, warnings } as OrderResponse;
  }

  async create(tenantId: string, dto: CreateOrderDto, createdBy?: string): Promise<OrderResponse> {
    const status = dto.status ?? 'open';
    const channel = dto.channel ?? 'online';
    const { lines, total: computedTotal } = await this.resolveLines(tenantId, dto.lines);

    this.assertLinesRequiredForStatus(status, lines);
    this.assertDraftMayHaveEmptyLines(status, lines);

    let total = dto.total ?? 0;
    if (lines.length) {
      total = computedTotal;
    } else if (!isStockAppliedStatus(status) && dto.total !== undefined) {
      total = dto.total;
    }
    const shippingCost = dto.shippingCost ?? 0;
    const discountTotal = dto.discountTotal ?? 0;
    // Crédito de loja (Loop 9) é uma dedução final, tipo vale-presente — nunca mexe no cálculo do
    // cupom/desconto Pix, só subtrai por cima do total já composto por eles.
    const creditApplied = dto.creditApplied ?? 0;
    total = Math.max(0, total + shippingCost - discountTotal - creditApplied);

    // Confirma o cupom de forma atômica antes de criar o pedido — único chokepoint de
    // redenção (usado tanto pela criação direta no admin/PDV quanto pelo submit de
    // order-drafts), evita contar o mesmo cupom duas vezes ou pular a contagem.
    if (dto.couponCode) {
      await this.promotions.redeem(tenantId, dto.couponCode);
    }

    const warnings = await this.buildWarnings(tenantId, lines);

    if (isStockAppliedStatus(status)) {
      await this.assertStockSufficientForPay(tenantId, lines);
    }

    const nextNumber = await this.counters.next(tenantId, 'order');

    const created = await this.model.create({
      tenantId: new Types.ObjectId(tenantId),
      customerId: new Types.ObjectId(dto.customerId),
      number: nextNumber,
      channel,
      status,
      reference: dto.reference,
      total,
      notes: dto.notes,
      lines,
      shippingMethod: dto.shippingMethod,
      shippingCost,
      couponCode: dto.couponCode,
      discountTotal,
      creditApplied,
      createdBy: createdBy ? new Types.ObjectId(createdBy) : undefined,
      operatorUserId:
        dto.operatorUserId && Types.ObjectId.isValid(dto.operatorUserId)
          ? new Types.ObjectId(dto.operatorUserId)
          : undefined,
      paymentMethod: dto.paymentMethod,
      locationId:
        dto.locationId && Types.ObjectId.isValid(dto.locationId)
          ? new Types.ObjectId(dto.locationId)
          : undefined,
    });

    const oid = created._id as Types.ObjectId;
    const stockLines = lines.filter(l => !(l as any).isOrder);
    if (isStockAppliedStatus(status) && stockLines.length) {
      try {
        await this.products.applySaleDeductionsForOrder(
          oid,
          stockLines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
          createdBy,
          tenantId,
          dto.locationId,
        );
      } catch (e) {
        // Atomic decrement lost the race (concurrent sale took the last unit) —
        // don't leave a ghost order pointing at stock that was never actually deducted.
        await created.deleteOne();
        throw e;
      }
    }

    if (status === 'completed') {
      await this.loyalty.creditForOrder(tenantId, created.customerId, total);
    }

    return this.toResponse(
      created.toObject() as unknown as Record<string, unknown>,
      warnings,
    );
  }

  /**
   * Ingests a batch of offline PDV sales idempotently. Never blocks on insufficient stock:
   * per line, reserves as much as the location (and tenant total) actually have via
   * `ProductsService.reserveForOfflineSale`, and auto-converts any shortfall into a
   * backorder line (`isOrder: true`) — the exact mechanism already used for manual
   * encomendas, just triggered automatically here. Replaying the same `clientSaleId` (e.g.
   * a PDV retry after a dropped response) is a pure no-op: it returns the order that already
   * exists instead of creating a duplicate or re-touching stock.
   */
  async syncBatch(
    tenantId: string,
    locationId: string | undefined,
    sales: Array<{
      clientSaleId: string;
      customerId: string;
      paymentMethod: 'pix' | 'cash' | 'card';
      notes?: string;
      lines: OrderLineInputDto[];
    }>,
    createdBy?: string,
  ): Promise<
    Array<{
      clientSaleId: string;
      orderId: string;
      orderNumber: number;
      status: 'ok' | 'partial_backorder';
      downgradedLines?: Array<{ variantId: string; requested: number; fulfilled: number }>;
    }>
  > {
    const results: Array<{
      clientSaleId: string;
      orderId: string;
      orderNumber: number;
      status: 'ok' | 'partial_backorder';
      downgradedLines?: Array<{ variantId: string; requested: number; fulfilled: number }>;
    }> = [];
    for (const sale of sales) {
      results.push(await this.syncOneOfflineSale(tenantId, locationId, sale, createdBy));
    }
    return results;
  }

  private async syncOneOfflineSale(
    tenantId: string,
    locationId: string | undefined,
    sale: {
      clientSaleId: string;
      customerId: string;
      paymentMethod: 'pix' | 'cash' | 'card';
      notes?: string;
      lines: OrderLineInputDto[];
    },
    createdBy?: string,
  ): Promise<{
    clientSaleId: string;
    orderId: string;
    orderNumber: number;
    status: 'ok' | 'partial_backorder';
    downgradedLines?: Array<{ variantId: string; requested: number; fulfilled: number }>;
  }> {
    const tid = new Types.ObjectId(tenantId);

    const existing = await this.model
      .findOne({ tenantId: tid, clientSaleId: sale.clientSaleId })
      .lean()
      .exec();
    if (existing) {
      return {
        clientSaleId: sale.clientSaleId,
        orderId: String(existing._id),
        orderNumber: existing.number,
        status: existing.autoBackorderedAt ? 'partial_backorder' : 'ok',
      };
    }

    const { lines: resolvedLines, total } = await this.resolveLines(tenantId, sale.lines);
    this.assertLinesRequiredForStatus('completed', resolvedLines);

    const oid = new Types.ObjectId();
    const finalLines: Order['lines'] = [];
    const downgradedLines: Array<{ variantId: string; requested: number; fulfilled: number }> = [];

    for (const line of resolvedLines) {
      if (line.isOrder) {
        // Already an explicit encomenda from the PDV itself — never touches stock, same as
        // every other order-creation path.
        finalLines.push(line);
        continue;
      }
      const fulfilled = await this.products.reserveForOfflineSale(
        tenantId,
        String(line.variantId),
        locationId,
        line.quantity,
        oid,
        createdBy,
      );
      if (fulfilled >= line.quantity) {
        finalLines.push(line);
        continue;
      }
      downgradedLines.push({ variantId: String(line.variantId), requested: line.quantity, fulfilled });
      if (fulfilled > 0) {
        finalLines.push({ ...line, quantity: fulfilled });
      }
      finalLines.push({ ...line, quantity: line.quantity - fulfilled, isOrder: true });
    }

    const status = downgradedLines.length || finalLines.some((l) => l.isOrder) ? 'open' : 'completed';

    let created;
    try {
      created = await this.model.create({
        _id: oid,
        tenantId: tid,
        customerId: new Types.ObjectId(sale.customerId),
        number: await this.counters.next(tenantId, 'order'),
        channel: 'in_person',
        status,
        total,
        notes: sale.notes,
        lines: finalLines,
        paymentMethod: sale.paymentMethod,
        locationId: locationId && Types.ObjectId.isValid(locationId) ? new Types.ObjectId(locationId) : undefined,
        clientSaleId: sale.clientSaleId,
        createdBy: createdBy ? new Types.ObjectId(createdBy) : undefined,
        autoBackorderedAt: downgradedLines.length ? new Date() : undefined,
        autoBackorderNote: downgradedLines.length
          ? `Sincronização converteu ${downgradedLines.length} linha(s) em encomenda por falta de estoque no local no momento do envio.`
          : undefined,
      });
    } catch (e: any) {
      if (e?.code === 11000) {
        // Lost a race against a concurrent replay of the same clientSaleId — this attempt's
        // reservations are the loser and must be reversed; the order that actually won is
        // the source of truth to report back.
        const touchedVariants = new Set(finalLines.filter((l) => !l.isOrder).map((l) => String(l.variantId)));
        for (const vid of touchedVariants) {
          await this.products
            .applySaleReversalForOrderVariant(oid, vid, createdBy, tenantId, locationId)
            .catch(() => undefined);
        }
        const winner = await this.model
          .findOne({ tenantId: tid, clientSaleId: sale.clientSaleId })
          .lean()
          .exec();
        if (winner) {
          return {
            clientSaleId: sale.clientSaleId,
            orderId: String(winner._id),
            orderNumber: winner.number,
            status: winner.autoBackorderedAt ? 'partial_backorder' : 'ok',
          };
        }
      }
      throw e;
    }

    if (status === 'completed') {
      await this.loyalty.creditForOrder(tenantId, created.customerId, total);
    }

    if (downgradedLines.length) {
      const subject = `[LM FIT] Venda offline ajustada na sincronização (pedido ${created.number})`;
      const text = `A sincronização do PDV converteu ${downgradedLines.length} linha(s) em encomenda por falta de estoque no local no momento do envio.\nPedido: ${created.number} (${String(created._id)})\nLinhas afetadas: ${downgradedLines
        .map((l) => `variante ${l.variantId} (pedido ${l.requested}, disponível ${l.fulfilled})`)
        .join('; ')}`;
      await this.notifications.sendStaffEmail(subject, text).catch(() => undefined);
      this.notifications.logStaffAlert('offline_sale_auto_backordered', {
        orderId: String(created._id),
        orderNumber: created.number,
        clientSaleId: sale.clientSaleId,
        downgradedLines,
      });
    }

    return {
      clientSaleId: sale.clientSaleId,
      orderId: String(created._id),
      orderNumber: created.number,
      status: downgradedLines.length ? 'partial_backorder' : 'ok',
      downgradedLines: downgradedLines.length ? downgradedLines : undefined,
    };
  }

  private listFilter(tenantId: string, search?: string, channel?: string) {
    const parts: Record<string, unknown>[] = [{ tenantId: new Types.ObjectId(tenantId) }];
    if (search) {
      // Escape user input before building the regex — an unescaped search string lets a
      // client submit regex metacharacters (e.g. nested quantifiers) that make MongoDB's
      // regex engine hang on evaluation (ReDoS), the same class of bug already fixed for
      // products/customers search via `escapeRegex`.
      const safe = escapeRegex(search);
      const or: Record<string, unknown>[] = [
        { reference: new RegExp(safe, 'i') },
        { notes: new RegExp(safe, 'i') },
      ];
      const asNumber = Number(search);
      if (Number.isInteger(asNumber)) or.push({ number: asNumber });
      parts.push({ $or: or });
    }
    if (channel && (ORDER_CHANNELS as readonly string[]).includes(channel)) {
      parts.push({ channel });
    }
    return { $and: parts };
  }

  async findAll(
    tenantId: string,
    page: number,
    limit: number,
    search?: string,
    channel?: string,
  ) {
    const skip = skipFromPage(page, limit);
    const q = this.listFilter(tenantId, search, channel);
    const [items, total] = await Promise.all([
      this.model.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.model.countDocuments(q).exec(),
    ]);
    return { items, total, page, limit };
  }

  /** Projeção segura para o cliente logado em `/me/orders` — sem campos internos (createdBy, operatorUserId, notes). */
  async findAllForCustomer(tenantId: string, customerId: string, page: number, limit: number) {
    if (!Types.ObjectId.isValid(customerId)) return { items: [], total: 0, page, limit };
    const skip = skipFromPage(page, limit);
    const q = { tenantId: new Types.ObjectId(tenantId), customerId: new Types.ObjectId(customerId) };
    const [orders, total] = await Promise.all([
      this.model
        .find(q)
        .select('customerId number status total shippingMethod shippingCost carrier trackingCode trackingUrl lines createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.model.countDocuments(q).exec(),
    ]);

    const orderIds = orders.map((o) => o._id);
    const payments = orderIds.length
      ? await this.paymentModel
          .find({ tenantId: new Types.ObjectId(tenantId), orderId: { $in: orderIds } })
          .select('orderId status method')
          .lean()
          .exec()
      : [];
    const paymentByOrderId = new Map(payments.map((p) => [String(p.orderId), p]));

    const items = orders.map((o) => {
      const payment = paymentByOrderId.get(String(o._id));
      return {
        id: String(o._id),
        number: o.number,
        status: o.status,
        total: o.total,
        shippingMethod: o.shippingMethod ?? null,
        shippingCost: o.shippingCost,
        carrier: o.carrier ?? null,
        trackingCode: o.trackingCode ?? null,
        trackingUrl: o.trackingUrl ?? null,
        lines: o.lines,
        createdAt: (o as unknown as { createdAt: Date }).createdAt,
        payment: payment ? { status: payment.status, method: payment.method } : null,
      };
    });

    return { items, total, page, limit };
  }

  async findAllForExport(tenantId: string, search?: string, channel?: string) {
    const q = this.listFilter(tenantId, search, channel);
    return this.model.find(q).sort({ createdAt: -1 }).lean().exec();
  }

  serializeRow(doc: Record<string, unknown>): Record<string, unknown> {
    const o: Record<string, unknown> = { ...doc };
    if (o._id) o._id = String(o._id);
    if (o.customerId) o.customerId = String(o.customerId);
    if (o.createdBy) o.createdBy = String(o.createdBy);
    if (o.operatorUserId) o.operatorUserId = String(o.operatorUserId);
    if (Array.isArray(o.lines)) {
      o.lines = JSON.stringify(o.lines);
    }
    if (o.createdAt instanceof Date) o.createdAt = o.createdAt.toISOString();
    if (o.updatedAt instanceof Date) o.updatedAt = o.updatedAt.toISOString();
    return o;
  }

  async exportBuffer(
    tenantId: string,
    format: 'xlsx' | 'csv',
    search?: string,
    channel?: string,
  ): Promise<{ buffer: Buffer; filename: string; mime: string }> {
    const docs = await this.findAllForExport(tenantId, search, channel);
    const rows = docs.map((d) =>
      this.serializeRow(d as unknown as Record<string, unknown>),
    );
    const buffer =
      format === 'csv'
        ? this.excel.buildCsvBuffer(ORDER_EXPORT_COLUMNS, rows)
        : await this.excel.buildXlsxBuffer('Pedidos', ORDER_EXPORT_COLUMNS, rows);
    return {
      buffer,
      filename: `orders.${format === 'csv' ? 'csv' : 'xlsx'}`,
      mime:
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private parseLinesCell(raw: unknown): OrderLineInputDto[] | undefined {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return undefined;
    }
    try {
      const parsed = JSON.parse(String(raw)) as unknown;
      if (!Array.isArray(parsed)) {
        throw new BadRequestException('lines deve ser um array JSON');
      }
      return parsed as OrderLineInputDto[];
    } catch {
      throw new BadRequestException('lines JSON inválido');
    }
  }

  private parseRow(row: Record<string, unknown>): {
    id?: string;
    create?: CreateOrderDto;
    patch: UpdateOrderDto;
  } {
    const idRaw = row._id ?? row.id;
    const id =
      idRaw !== undefined && idRaw !== '' && String(idRaw).length === 24
        ? String(idRaw)
        : undefined;
    const lines = this.parseLinesCell(row.lines);
    const total =
      row.total !== undefined && String(row.total).trim() !== ''
        ? Number(row.total)
        : undefined;
    if (total !== undefined && (Number.isNaN(total) || total < 0)) {
      throw new BadRequestException('total inválido');
    }
    const st = String(row.status ?? '').trim();
    const status =
      st &&
      ['open', 'picking', 'shipped', 'completed', 'cancelled'].includes(st)
        ? (st as 'open' | 'picking' | 'shipped' | 'completed' | 'cancelled')
        : undefined;
    const ch = String(row.channel ?? '').trim();
    const channel =
      ch && (ORDER_CHANNELS as readonly string[]).includes(ch)
        ? (ch as (typeof ORDER_CHANNELS)[number])
        : undefined;
    const patch: UpdateOrderDto = {
      channel,
      status,
      reference:
        row.reference !== undefined ? String(row.reference).trim() : undefined,
      total,
      notes: row.notes !== undefined ? String(row.notes).trim() : undefined,
      lines,
    };
    if (id) {
      return { id, patch };
    }
    const customerId = String(row.customerId ?? '').trim();
    if (!customerId || !Types.ObjectId.isValid(customerId)) {
      throw new BadRequestException('customerId é obrigatório para novos pedidos');
    }
    const create: CreateOrderDto = {
      customerId,
      channel: patch.channel,
      status: patch.status,
      reference: patch.reference,
      total: patch.total,
      notes: patch.notes,
      lines,
    };
    return { id, create, patch };
  }

  async importFromJson(
    tenantId: string,
    items: Record<string, unknown>[],
    dryRun: boolean,
    createdBy?: string,
  ): Promise<StaffImportResponse> {
    return this.importRecords(tenantId, items, dryRun, createdBy);
  }

  async importFromXlsx(
    tenantId: string,
    buffer: Buffer,
    dryRun: boolean,
    createdBy?: string,
  ): Promise<StaffImportResponse> {
    const records = await this.excel.parseFirstSheetToRecords(
      buffer,
      orderImportHeaderAliases(),
    );
    return this.importRecords(tenantId, records, dryRun, createdBy);
  }

  private async importRecords(
    tenantId: string,
    items: Record<string, unknown>[],
    dryRun: boolean,
    createdBy?: string,
  ): Promise<StaffImportResponse> {
    const errors: { row: number; message: string }[] = [];
    let imported = 0;
    let updated = 0;
    const skipped = 0;

    for (let i = 0; i < items.length; i++) {
      const rowNum = i + 1;
      try {
        const { id, create, patch } = this.parseRow(items[i]);
        if (dryRun) {
          if (id && Types.ObjectId.isValid(id)) {
            const exists = await this.model.findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) }).lean().exec();
            if (!exists) {
              errors.push({
                row: rowNum,
                message: `_id não encontrado: ${id}`,
              });
            }
          }
          continue;
        }
        if (id && Types.ObjectId.isValid(id)) {
          const exists = await this.model.findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) }).exec();
          if (!exists) {
            errors.push({ row: rowNum, message: `_id não encontrado: ${id}` });
            continue;
          }
          await this.update(tenantId, id, patch, createdBy);
          updated++;
        } else {
          if (!create) {
            errors.push({
              row: rowNum,
              message: 'Linha sem _id precisa de customerId',
            });
            continue;
          }
          await this.create(tenantId, create, createdBy);
          imported++;
        }
      } catch (e) {
        const msg =
          e instanceof BadRequestException
            ? String(e.message)
            : e instanceof Error
              ? e.message
              : 'Erro desconhecido';
        errors.push({ row: rowNum, message: msg });
      }
    }

    if (dryRun) {
      return {
        imported: 0,
        updated: 0,
        skipped: 0,
        valid: items.length - errors.length,
        errors,
        message:
          errors.length === 0
            ? 'Validação concluída sem erros (dryRun).'
            : `Validação dryRun: ${errors.length} linha(s) com erro.`,
      };
    }

    return {
      imported,
      updated,
      skipped,
      errors,
      message:
        errors.length === 0
          ? 'Importação concluída.'
          : `Importação concluída com ${errors.length} erro(s).`,
    };
  }

  /** Usado por integrações de marketplace pra checar se um pedido externo já foi importado (dedupe por reference). */
  async findByReference(tenantId: string, reference: string) {
    return this.model
      .findOne({ tenantId: new Types.ObjectId(tenantId), reference })
      .lean()
      .exec();
  }

  async findOne(tenantId: string, id: string): Promise<OrderResponse> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model.findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) }).lean().exec();
    if (!doc) throw new NotFoundException();
    const warnings = await this.buildWarnings(tenantId, doc.lines ?? []);
    return this.toResponse(doc as unknown as Record<string, unknown>, warnings);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateOrderDto,
    createdBy?: string,
  ): Promise<OrderResponse> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const existing = await this.model.findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) }).exec();
    if (!existing) throw new NotFoundException();

    this.assertLinesNotEditableWhenLocked(existing.status, dto);

    const oldStatus = existing.status;
    let lines = existing.lines ?? [];
    let total = existing.total;

    if (dto.lines !== undefined) {
      const resolved = await this.resolveLines(tenantId, dto.lines);
      lines = resolved.lines;
      total = resolved.lines.length
        ? resolved.total
        : (dto.total ?? existing.total);
    } else if (dto.total !== undefined) {
      total = dto.total;
    }

    const newStatus = dto.status ?? oldStatus;
    const channel = dto.channel ?? existing.channel ?? 'online';

    this.assertLinesRequiredForStatus(newStatus, lines);
    this.assertDraftMayHaveEmptyLines(newStatus, lines);

    const warnings = await this.buildWarnings(tenantId, lines);

    // A syncBatch order (PDV offline, `clientSaleId` set) already deducted stock for its
    // non-backorder lines at sync time even though it can land on 'open' (one line became a
    // backorder) — `isStockAppliedStatus` alone doesn't know that, and would otherwise treat
    // a later transition off `open` as "stock was never applied", causing it to skip the
    // reversal on cancel or to re-run the (idempotent, but pointless) deduction on complete.
    const wasApplied = isStockAppliedStatus(oldStatus) || !!existing.clientSaleId;
    const willApply = isStockAppliedStatus(newStatus);

    if (!wasApplied && willApply) {
      await this.assertStockSufficientForPay(tenantId, lines);
    }

    const existingLocationId = existing.locationId ? String(existing.locationId) : undefined;

    if (wasApplied && !willApply) {
      await this.products.applySaleReversalsForOrder(
        existing._id as Types.ObjectId,
        lines.map((l) => ({ variantId: l.variantId })),
        createdBy,
        tenantId,
        existingLocationId,
      );
    }

    const stockLines = lines.filter(l => !(l as any).isOrder);
    if (!wasApplied && willApply && stockLines.length) {
      await this.products.applySaleDeductionsForOrder(
        existing._id as Types.ObjectId,
        stockLines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        createdBy,
        tenantId,
        existingLocationId,
      );
    }

    existing.channel = channel;
    existing.status = newStatus;
    if (dto.reference !== undefined) existing.reference = dto.reference;
    if (dto.notes !== undefined) existing.notes = dto.notes;
    if (dto.operatorUserId !== undefined) {
      existing.operatorUserId =
        dto.operatorUserId && Types.ObjectId.isValid(dto.operatorUserId)
          ? new Types.ObjectId(dto.operatorUserId)
          : undefined;
    }
    if (dto.paymentMethod !== undefined) {
      existing.paymentMethod = dto.paymentMethod;
    }
    if (dto.carrier !== undefined) existing.carrier = dto.carrier;
    if (dto.trackingCode !== undefined) existing.trackingCode = dto.trackingCode;
    if (dto.trackingUrl !== undefined) existing.trackingUrl = dto.trackingUrl;
    // Idempotência: só dispara o e-mail "pedido enviado" na PRIMEIRA transição para 'shipped' —
    // `shippedNotifiedAt` uma vez setado nunca é limpo, então uma segunda PATCH para 'shipped'
    // (ou qualquer outra mudança de status depois) nunca reenvia (mesmo padrão de guarda
    // `oldStatus !== newStatus` já usado abaixo para 'completed'/loyalty).
    const shouldNotifyShipped = oldStatus !== 'shipped' && newStatus === 'shipped' && !existing.shippedNotifiedAt;
    if (shouldNotifyShipped) {
      existing.shippedNotifiedAt = new Date();
    }

    existing.lines = lines;
    existing.total = total;
    await existing.save();

    if (!wasApplied && willApply && newStatus === 'completed') {
      await this.payments.syncPaymentPaidForOrder(tenantId, existing._id as Types.ObjectId);
    }
    if (oldStatus !== 'completed' && newStatus === 'completed') {
      await this.loyalty.creditForOrder(tenantId, existing.customerId, existing.total);
    }
    if (
      newStatus === 'cancelled' &&
      oldStatus === 'open' &&
      !wasApplied
    ) {
      await this.payments.cancelPendingForOrder(tenantId, existing._id as Types.ObjectId);
    }
    if (shouldNotifyShipped) {
      await this.notifyOrderShipped(tenantId, existing.customerId, existing.number);
    }

    const lean = existing.toObject();
    return this.toResponse(lean as unknown as Record<string, unknown>, warnings);
  }

  private async notifyOrderShipped(tenantId: string, customerId: Types.ObjectId, orderNumber: number) {
    const customer = await this.customerModel
      .findOne({ _id: customerId, tenantId: new Types.ObjectId(tenantId) })
      .lean()
      .exec();
    if (!customer?.email) return;
    try {
      await this.notifications.sendEmail(
        customer.email,
        `Seu pedido #${orderNumber} foi enviado`,
        `Boas notícias! Seu pedido #${orderNumber} já está a caminho.`,
      );
    } catch {
      // Falha de entrega é uma preocupação de infraestrutura separada — mesma postura do Loop 7
      // (magic link) e do Loop 8 (aprovação/rejeição de devolução): não bloqueia a transição de status.
    }
  }

  async remove(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model.findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) }).exec();
    if (!doc) throw new NotFoundException();
    if (doc.status === 'open') {
      await this.payments.cancelPendingForOrder(tenantId, doc._id as Types.ObjectId);
    }
    // A syncBatch order (PDV offline, `clientSaleId` set) deducts stock for its non-backorder
    // lines the moment it's synced, regardless of the resulting status — unlike a normal
    // draft, an "open" synced order (open only because one line became a backorder) still
    // has real stock already applied for the rest. `isStockAppliedStatus` alone would miss
    // that and silently skip the reversal below.
    const stockWasApplied = isStockAppliedStatus(doc.status) || !!doc.clientSaleId;
    if (stockWasApplied && (doc.lines?.length ?? 0) > 0) {
      const stockLines = (doc.lines ?? []).filter(l => !(l as any).isOrder);
      if (stockLines.length > 0) {
        await this.products.applySaleReversalsForOrder(
          doc._id as Types.ObjectId,
          stockLines.map((l) => ({ variantId: l.variantId })),
          undefined,
          tenantId,
          doc.locationId ? String(doc.locationId) : undefined,
        );
      }
    }
    await doc.deleteOne();
    return { deleted: true };
  }
}
