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
import type { CreatePublicOrderDto } from './dto/create-public-order.dto';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { OrderLineInputDto } from './dto/order-line-input.dto';
import type { UpdateOrderDto } from './dto/update-order.dto';
import { ORDER_EXPORT_COLUMNS, orderImportHeaderAliases } from './order-excel.constants';
import { Order } from './schemas/order.schema';
import { ORDER_CHANNELS } from './types/order-channel';
import type { OrderWarning } from './types/order-warning';
import { PaymentsService } from '../payments/payments.service';

const STOCK_APPLIED_STATUSES = ['paid', 'fulfilled'] as const;

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
    @Inject(forwardRef(() => PaymentsService))
    private readonly payments: PaymentsService,
  ) {}

  private assertLinesRequiredForStatus(status: string, lines: Order['lines']) {
    if (isStockAppliedStatus(status) && (!lines || lines.length === 0)) {
      throw new UnprocessableEntityException({
        message:
          'Pedido pago ou atendido precisa de pelo menos uma linha com produto (variante).',
      });
    }
  }

  private assertDraftMayHaveEmptyLines(status: string, lines: Order['lines']) {
    if (status === 'draft' || status === 'cancelled') return;
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
      (currentStatus === 'paid' || currentStatus === 'fulfilled')
    ) {
      throw new UnprocessableEntityException({
        message:
          'Não é possível alterar itens de pedido já pago ou atendido. Cancele o pedido ou ajuste o estoque manualmente, se aplicável.',
      });
    }
  }

  private async resolveLines(
    inputs?: OrderLineInputDto[],
  ): Promise<{ lines: Order['lines']; total: number }> {
    if (!inputs?.length) {
      return { lines: [], total: 0 };
    }
    const lines: Order['lines'] = [];
    let sum = 0;
    for (const line of inputs) {
      if (!Types.ObjectId.isValid(line.variantId)) {
        throw new BadRequestException(`Variante inválida ${line.variantId}`);
      }
      const v = await this.variantModel.findById(line.variantId).exec();
      if (!v) {
        throw new BadRequestException(`Variante não encontrada ${line.variantId}`);
      }
      const unitPrice = line.unitPrice;
      sum += unitPrice * line.quantity;
      lines.push({
        variantId: new Types.ObjectId(line.variantId),
        quantity: line.quantity,
        unitPrice,
        description: line.description,
      });
    }
    return { lines, total: sum };
  }

  private async loadVariantsByIds(
    variantIds: Types.ObjectId[],
  ): Promise<Map<string, ProductVariant>> {
    const map = new Map<string, ProductVariant>();
    if (!variantIds.length) return map;
    const docs = await this.variantModel
      .find({ _id: { $in: variantIds } })
      .lean()
      .exec();
    for (const d of docs) {
      map.set(String(d._id), d as unknown as ProductVariant);
    }
    return map;
  }

  private async buildWarnings(lines: Order['lines']): Promise<OrderWarning[]> {
    const warnings: OrderWarning[] = [];
    if (!lines?.length) return warnings;
    const ids = [...new Set(lines.map((l) => l.variantId))];
    const variants = await this.loadVariantsByIds(ids);
    const pendingMap = await this.purchases.sumPendingOutstandingByVariantIds(ids);

    for (const line of lines) {
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

  /** Agrupa quantidade por variante para checagem de estoque físico. */
  private groupedQuantities(lines: Order['lines']): Map<string, number> {
    const m = new Map<string, number>();
    for (const line of lines) {
      const k = String(line.variantId);
      m.set(k, (m.get(k) ?? 0) + line.quantity);
    }
    return m;
  }

  private async assertStockSufficientForPay(lines: Order['lines']) {
    if (!lines.length) return;
    const ids = lines.map((l) => l.variantId);
    const variants = await this.loadVariantsByIds(ids);
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

  async create(dto: CreateOrderDto, createdBy?: string): Promise<OrderResponse> {
    const status = dto.status ?? 'draft';
    const channel = dto.channel ?? 'online';
    const { lines, total: computedTotal } = await this.resolveLines(dto.lines);

    this.assertLinesRequiredForStatus(status, lines);
    this.assertDraftMayHaveEmptyLines(status, lines);

    let total = dto.total ?? 0;
    if (lines.length) {
      total = computedTotal;
    } else if (!isStockAppliedStatus(status) && dto.total !== undefined) {
      total = dto.total;
    }

    const warnings = await this.buildWarnings(lines);

    if (isStockAppliedStatus(status)) {
      await this.assertStockSufficientForPay(lines);
    }

    const created = await this.model.create({
      customerId: new Types.ObjectId(dto.customerId),
      channel,
      status,
      reference: dto.reference,
      total,
      notes: dto.notes,
      lines,
      createdBy: createdBy ? new Types.ObjectId(createdBy) : undefined,
      operatorUserId:
        dto.operatorUserId && Types.ObjectId.isValid(dto.operatorUserId)
          ? new Types.ObjectId(dto.operatorUserId)
          : undefined,
      paymentMethod: dto.paymentMethod,
    });

    const oid = created._id as Types.ObjectId;
    if (isStockAppliedStatus(status) && lines.length) {
      await this.products.applySaleDeductionsForOrder(
        oid,
        lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        createdBy,
      );
    }

    return this.toResponse(
      created.toObject() as unknown as Record<string, unknown>,
      warnings,
    );
  }

  private listFilter(search?: string, channel?: string) {
    const parts: Record<string, unknown>[] = [];
    if (search) {
      parts.push({
        $or: [
          { reference: new RegExp(search, 'i') },
          { notes: new RegExp(search, 'i') },
        ],
      });
    }
    if (channel && (ORDER_CHANNELS as readonly string[]).includes(channel)) {
      parts.push({ channel });
    }
    if (!parts.length) return {};
    if (parts.length === 1) return parts[0];
    return { $and: parts };
  }

  async findAll(
    page: number,
    limit: number,
    search?: string,
    channel?: string,
  ) {
    const skip = skipFromPage(page, limit);
    const q = this.listFilter(search, channel);
    const [items, total] = await Promise.all([
      this.model.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.model.countDocuments(q).exec(),
    ]);
    return { items, total, page, limit };
  }

  async findAllForExport(search?: string, channel?: string) {
    const q = this.listFilter(search, channel);
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
    format: 'xlsx' | 'csv',
    search?: string,
    channel?: string,
  ): Promise<{ buffer: Buffer; filename: string; mime: string }> {
    const docs = await this.findAllForExport(search, channel);
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
      ['draft', 'pending_payment', 'paid', 'fulfilled', 'cancelled'].includes(st)
        ? (st as 'draft' | 'pending_payment' | 'paid' | 'fulfilled' | 'cancelled')
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
    items: Record<string, unknown>[],
    dryRun: boolean,
    createdBy?: string,
  ): Promise<StaffImportResponse> {
    return this.importRecords(items, dryRun, createdBy);
  }

  async importFromXlsx(
    buffer: Buffer,
    dryRun: boolean,
    createdBy?: string,
  ): Promise<StaffImportResponse> {
    const records = await this.excel.parseFirstSheetToRecords(
      buffer,
      orderImportHeaderAliases(),
    );
    return this.importRecords(records, dryRun, createdBy);
  }

  private async importRecords(
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
            const exists = await this.model.findById(id).lean().exec();
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
          const exists = await this.model.findById(id).exec();
          if (!exists) {
            errors.push({ row: rowNum, message: `_id não encontrado: ${id}` });
            continue;
          }
          await this.update(id, patch, createdBy);
          updated++;
        } else {
          if (!create) {
            errors.push({
              row: rowNum,
              message: 'Linha sem _id precisa de customerId',
            });
            continue;
          }
          await this.create(create, createdBy);
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

  async findOne(id: string): Promise<OrderResponse> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model.findById(id).lean().exec();
    if (!doc) throw new NotFoundException();
    const warnings = await this.buildWarnings(doc.lines ?? []);
    return this.toResponse(doc as unknown as Record<string, unknown>, warnings);
  }

  async update(
    id: string,
    dto: UpdateOrderDto,
    createdBy?: string,
  ): Promise<OrderResponse> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const existing = await this.model.findById(id).exec();
    if (!existing) throw new NotFoundException();

    this.assertLinesNotEditableWhenLocked(existing.status, dto);

    const oldStatus = existing.status;
    let lines = existing.lines ?? [];
    let total = existing.total;

    if (dto.lines !== undefined) {
      const resolved = await this.resolveLines(dto.lines);
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

    const warnings = await this.buildWarnings(lines);

    const wasApplied = isStockAppliedStatus(oldStatus);
    const willApply = isStockAppliedStatus(newStatus);

    if (!wasApplied && willApply) {
      await this.assertStockSufficientForPay(lines);
    }

    if (wasApplied && !willApply) {
      await this.products.applySaleReversalsForOrder(
        existing._id as Types.ObjectId,
        lines.map((l) => ({ variantId: l.variantId })),
        createdBy,
      );
    }

    if (!wasApplied && willApply && lines.length) {
      await this.products.applySaleDeductionsForOrder(
        existing._id as Types.ObjectId,
        lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        createdBy,
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

    if (!wasApplied && willApply && newStatus === 'paid') {
      await this.payments.syncPaymentPaidForOrder(existing._id as Types.ObjectId);
    }
    if (
      newStatus === 'cancelled' &&
      oldStatus === 'pending_payment' &&
      !wasApplied
    ) {
      await this.payments.cancelPendingForOrder(existing._id as Types.ObjectId);
    }

    const lean = existing.toObject();
    return this.toResponse(lean as unknown as Record<string, unknown>, warnings);
  }

  async createFromPublic(dto: CreatePublicOrderDto): Promise<Record<string, unknown>> {
    if (dto.payment?.method === 'pix') {
      const res = await this.create(
        {
          customerId: dto.customerId,
          channel: dto.channel ?? 'online',
          status: 'pending_payment',
          lines: dto.lines,
          reference: dto.reference,
          notes: dto.notes,
        },
        undefined,
      );
      const total = Number(res.total ?? 0);
      const pay = await this.payments.createPixPayment(String(res._id), total);
      return {
        orderId: String(res._id),
        warnings: res.warnings,
        payment: {
          paymentId: String(pay._id),
          qrCode: pay.qrCode,
          qrCodeImage: pay.qrCodeImage,
          expiresAt: (pay.expiresAt as Date).toISOString(),
        },
      };
    }
    const res = await this.create(
      {
        customerId: dto.customerId,
        channel: dto.channel ?? 'online',
        status: 'draft',
        lines: dto.lines,
        reference: dto.reference,
        notes: dto.notes,
      },
      undefined,
    );
    return { orderId: String(res._id), warnings: res.warnings };
  }

  async remove(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException();
    if (doc.status === 'pending_payment') {
      await this.payments.cancelPendingForOrder(doc._id as Types.ObjectId);
    }
    if (isStockAppliedStatus(doc.status) && (doc.lines?.length ?? 0) > 0) {
      await this.products.applySaleReversalsForOrder(
        doc._id as Types.ObjectId,
        (doc.lines ?? []).map((l) => ({ variantId: l.variantId })),
        undefined,
      );
    }
    await doc.deleteOne();
    return { deleted: true };
  }
}
