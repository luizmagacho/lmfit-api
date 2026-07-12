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
import { escapeRegex } from '../common/utils/text-search.util';

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
    private readonly excel: ExcelSpreadsheetService,
    private readonly products: ProductsService,
    private readonly purchases: PurchasesService,
    private readonly loyalty: LoyaltyService,
    private readonly promotions: PromotionsService,
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
      const pricing = pricingByVariant.get(line.variantId);
      if (pricing && unitPrice <= pricing.priceWholesale && line.quantity < pricing.minWholesaleQty) {
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
    total = Math.max(0, total + shippingCost - discountTotal);

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

    const nextNumber = (await this.model.countDocuments({ tenantId: new Types.ObjectId(tenantId) }).exec()) + 1;

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
      createdBy: createdBy ? new Types.ObjectId(createdBy) : undefined,
      operatorUserId:
        dto.operatorUserId && Types.ObjectId.isValid(dto.operatorUserId)
          ? new Types.ObjectId(dto.operatorUserId)
          : undefined,
      paymentMethod: dto.paymentMethod,
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

    const wasApplied = isStockAppliedStatus(oldStatus);
    const willApply = isStockAppliedStatus(newStatus);

    if (!wasApplied && willApply) {
      await this.assertStockSufficientForPay(tenantId, lines);
    }

    if (wasApplied && !willApply) {
      await this.products.applySaleReversalsForOrder(
        existing._id as Types.ObjectId,
        lines.map((l) => ({ variantId: l.variantId })),
        createdBy,
      );
    }

    const stockLines = lines.filter(l => !(l as any).isOrder);
    if (!wasApplied && willApply && stockLines.length) {
      await this.products.applySaleDeductionsForOrder(
        existing._id as Types.ObjectId,
        stockLines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        createdBy,
        tenantId,
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

    const lean = existing.toObject();
    return this.toResponse(lean as unknown as Record<string, unknown>, warnings);
  }

  async remove(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model.findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) }).exec();
    if (!doc) throw new NotFoundException();
    if (doc.status === 'open') {
      await this.payments.cancelPendingForOrder(tenantId, doc._id as Types.ObjectId);
    }
    if (isStockAppliedStatus(doc.status) && (doc.lines?.length ?? 0) > 0) {
      const stockLines = (doc.lines ?? []).filter(l => !(l as any).isOrder);
      if (stockLines.length > 0) {
        await this.products.applySaleReversalsForOrder(
          doc._id as Types.ObjectId,
          stockLines.map((l) => ({ variantId: l.variantId })),
          undefined,
          tenantId,
        );
      }
    }
    await doc.deleteOne();
    return { deleted: true };
  }
}
