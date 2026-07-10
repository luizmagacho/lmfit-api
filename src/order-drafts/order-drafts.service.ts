import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { skipFromPage } from '../common/dto/pagination-query.dto';
import type { StaffImportResponse } from '../common/dto/staff-import.response';
import { ExcelSpreadsheetService } from '../common/excel/excel-spreadsheet.service';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { CustomersService } from '../customers/customers.service';
import { ProductsService } from '../products/products.service';
import { ProductVariant } from '../products/schemas/product-variant.schema';
import {
  ORDER_DRAFT_EXPORT_COLUMNS,
  orderDraftImportHeaderAliases,
} from './order-draft-excel.constants';
import type { PublicCreateDraftDto } from './dto/public-patch-draft.dto';
import type { PublicPatchDraftDto } from './dto/public-patch-draft.dto';
import type { PublicSubmitDraftDto } from './dto/public-submit-draft.dto';
import type { StaffPatchOrderDraftDto } from './dto/staff-order-draft.dto';
import type { OrderDraftDocument } from './schemas/order-draft.schema';
import { OrderDraft } from './schemas/order-draft.schema';

@Injectable()
export class OrderDraftsService {
  constructor(
    @InjectModel(OrderDraft.name) private readonly draftModel: Model<OrderDraft>,
    @InjectModel(ProductVariant.name)
    private readonly variantModel: Model<ProductVariant>,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly customers: CustomersService,
    private readonly products: ProductsService,
    private readonly notify: NotificationsService,
    private readonly config: ConfigService,
    private readonly excel: ExcelSpreadsheetService,
  ) {}

  async createPublic(tenantId: string, dto: PublicCreateDraftDto) {
    const sessionToken = randomBytes(24).toString('hex');
    const doc = await this.draftModel.create({
      tenantId: new Types.ObjectId(tenantId),
      sessionToken,
      customerId: dto.customerId
        ? new Types.ObjectId(dto.customerId)
        : undefined,
      waId: dto.waId?.trim(),
      status: 'collecting',
      lines: [],
      metadata: dto.metadata,
    });
    return doc.toObject();
  }

  private normalizeToken(token: string): string {
    return decodeURIComponent(token.trim());
  }

  async getByToken(tenantId: string, token: string) {
    const t = this.normalizeToken(token);
    const doc = await this.draftModel
      .findOne({ sessionToken: t, tenantId: new Types.ObjectId(tenantId) })
      .lean()
      .exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }

  private assertDraftPatchable(doc: OrderDraftDocument, allowWhenLocked: boolean) {
    if (allowWhenLocked) return;
    if (doc.status === 'submitted' || doc.status === 'assigned') {
      throw new BadRequestException('Draft is locked');
    }
  }

  private async rebuildLinesFromDto(
    tenantId: string,
    lines: NonNullable<PublicPatchDraftDto['lines']>,
    enforceStock: boolean,
    allowBackorder: boolean,
  ): Promise<OrderDraft['lines']> {
    if (!lines?.length) return [];
    const built: OrderDraft['lines'] = [];
    for (const line of lines) {
      if (!Types.ObjectId.isValid(line.variantId)) {
        throw new BadRequestException('Invalid variant');
      }
      const v = await this.variantModel
        .findOne({ _id: line.variantId, tenantId: new Types.ObjectId(tenantId) })
        .exec();
      if (!v) throw new BadRequestException('Variant not found');
      // Public checkout blocks selling past on-hand stock, unless the variant is
      // explicitly marked as accepting backorder AND the tenant's plan allows it
      // (feature "production" — encomenda is fulfilled via the production module).
      let isOrder = false;
      if (enforceStock) {
        const available = v.quantityOnHand ?? 0;
        if (line.quantity > available) {
          const minQty = v.backorderMinQty ?? 1;
          if (allowBackorder && v.acceptsBackorder && line.quantity >= minQty) {
            isOrder = true;
          } else if (allowBackorder && v.acceptsBackorder) {
            throw new BadRequestException(
              `Encomenda de ${v.sku} só a partir de ${minQty} unidade(s): solicitado ${line.quantity}`,
            );
          } else {
            throw new BadRequestException(
              `Estoque insuficiente para ${v.sku}: disponível ${available}, solicitado ${line.quantity}`,
            );
          }
        }
      }
      // Price is always computed server-side from quantity + the product's own
      // wholesale rule — never trust a client-sent unit price (price manipulation risk).
      const pricing = await this.products.getWholesalePricing(tenantId, String(v._id));
      const unitPrice =
        pricing && line.quantity >= pricing.minWholesaleQty
          ? pricing.priceWholesale
          : (pricing?.priceRetail ?? v.price ?? 0);
      built.push({
        variantId: v._id as Types.ObjectId,
        quantity: line.quantity,
        unitPrice,
        isOrder,
      });
    }
    return built;
  }

  private async applyDraftPatch(
    tenantId: string,
    doc: OrderDraftDocument,
    dto: StaffPatchOrderDraftDto,
    allowWhenLocked: boolean,
    enforceStock: boolean,
    allowBackorder: boolean,
  ): Promise<void> {
    this.assertDraftPatchable(doc, allowWhenLocked);
    if (dto.lines) {
      doc.lines = await this.rebuildLinesFromDto(tenantId, dto.lines, enforceStock, allowBackorder);
    }
    if (dto.status !== undefined) doc.status = dto.status;
    if (dto.paymentMethodChoice !== undefined) {
      doc.paymentMethodChoice = dto.paymentMethodChoice;
    }
    if (dto.customerId !== undefined) {
      doc.customerId = dto.customerId
        ? new Types.ObjectId(dto.customerId)
        : undefined;
    }
    if (dto.waId !== undefined) {
      doc.waId = dto.waId?.trim();
    }
    if (dto.assignedSalesUserId !== undefined) {
      doc.assignedSalesUserId = dto.assignedSalesUserId
        ? new Types.ObjectId(dto.assignedSalesUserId)
        : undefined;
    }
    if (dto.metadata !== undefined) {
      doc.metadata = {
        ...(doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : {}),
        ...dto.metadata,
      };
    }
  }

  async patchByToken(
    tenantId: string,
    token: string,
    dto: PublicPatchDraftDto,
    tenantFeatures: string[] = [],
  ) {
    const t = this.normalizeToken(token);
    const doc = await this.draftModel
      .findOne({ sessionToken: t, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!doc) throw new NotFoundException();
    const allowBackorder = tenantFeatures.includes('production');
    await this.applyDraftPatch(tenantId, doc, dto as StaffPatchOrderDraftDto, false, true, allowBackorder);
    await doc.save();
    return doc.toObject();
  }

  async patchForStaff(tenantId: string, token: string, dto: StaffPatchOrderDraftDto) {
    const t = this.normalizeToken(token);
    const doc = await this.draftModel
      .findOne({ sessionToken: t, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!doc) throw new NotFoundException();
    await this.applyDraftPatch(tenantId, doc, dto, true, false, true);
    await doc.save();
    return doc.toObject();
  }

  async removeByTokenForStaff(tenantId: string, token: string) {
    const t = this.normalizeToken(token);
    const res = await this.draftModel
      .findOneAndDelete({ sessionToken: t, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!res) throw new NotFoundException();
    return { deleted: true };
  }

  async submitByToken(tenantId: string, token: string, body?: PublicSubmitDraftDto) {
    const t = this.normalizeToken(token);
    const doc = await this.draftModel
      .findOne({ sessionToken: t, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!doc) throw new NotFoundException();
    if (!doc.lines.length) throw new BadRequestException('No lines on draft');
    let customerId = doc.customerId ?? body?.customerId;

    // Resolve guest customer from metadata: reuse an existing customer matched by
    // WhatsApp/phone id instead of creating a duplicate record on every repeat purchase.
    if (!customerId && doc.metadata && typeof doc.metadata === 'object' && 'customer' in doc.metadata) {
      const custData = (doc.metadata as any).customer;
      if (custData && custData.name) {
        const waId = doc.waId?.trim();
        const existing = waId ? await this.customers.findByWaId(tenantId, waId) : null;
        if (existing) {
          customerId = existing._id;
        } else {
          const newCustomer = await this.customers.create(tenantId, {
            name: String(custData.name).trim(),
            phone: custData.phone ? String(custData.phone).trim() : undefined,
            email: custData.email ? String(custData.email).trim() : undefined,
            whatsappWaId: waId || undefined,
          });
          customerId = newCustomer._id;
        }
        doc.customerId = customerId as Types.ObjectId;
      }
    }

    if (!customerId || !Types.ObjectId.isValid(String(customerId))) {
      throw new BadRequestException('customerId is required to submit (or provide customer metadata)');
    }
    const lineInputs = doc.lines.map((l) => ({
      variantId: String(l.variantId),
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      isOrder: l.isOrder ?? false,
    }));
    const notesParts: string[] = [];
    if (doc.paymentMethodChoice) {
      notesParts.push(`Pagamento preferido: ${doc.paymentMethodChoice}`);
    }

    let referenceString = `draft:${doc.sessionToken}`;
    if (doc.metadata && typeof doc.metadata === 'object' && 'customer' in doc.metadata) {
      const custData = (doc.metadata as any).customer;
      if (custData && custData.name && custData.phone) {
        const totalVal = doc.lines.reduce((acc, l) => acc + (l.unitPrice * l.quantity), 0);
        const fmtTotal = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalVal);
        referenceString = `WhatsApp: ${custData.name} - ${custData.phone} - ${fmtTotal}`;
      }
    }
    if (body?.payment?.method === 'pix') {
      const order = await this.orders.create(
        tenantId,
        {
          customerId: String(customerId),
          channel: 'online',
          status: 'open',
          reference: referenceString,
          notes: notesParts.length ? notesParts.join('\n') : undefined,
          lines: lineInputs,
        },
        undefined,
      );

      const total = Number(order.total ?? 0);
      const pay = await this.payments.createPixPayment(tenantId, String(order._id), total);
      doc.orderId = order._id as Types.ObjectId;
      doc.status = 'submitted';
      await doc.save();
      const web = this.config.get<string>('WEB_ADMIN_BASE_URL') ?? '';
      const subject = `[LM FIT] Pedido aguardando pagamento (${order._id})`;
      const text = `Pedido público (PIX).\nCliente: ${customerId}\nTotal: ${order.total}\nAdmin: ${web}/orders`;
      await this.notify.sendStaffEmail(subject, text).catch(() => undefined);
      this.notify.logStaffAlert('order_draft_submitted', {
        orderId: String(order._id),
        draftToken: doc.sessionToken,
      });
      return {
        orderId: String(order._id),
        payment: {
          paymentId: String(pay._id),
          qrCode: pay.qrCode,
          qrCodeImage: pay.qrCodeImage,
          expiresAt: (pay.expiresAt as Date).toISOString(),
        },
      };
    }

    if (body?.payment?.method === 'infinitepay') {
      const order = await this.orders.create(
        tenantId,
        {
          customerId: String(customerId),
          channel: 'online',
          status: 'open',
          reference: referenceString,
          notes: notesParts.length ? notesParts.join('\n') : undefined,
          lines: lineInputs,
        },
        undefined,
      );

      const total = Number(order.total ?? 0);
      const pay = await this.payments.createInfinitePayPayment(tenantId, String(order._id), total);
      doc.orderId = order._id as Types.ObjectId;
      doc.status = 'submitted';
      await doc.save();
      const web = this.config.get<string>('WEB_ADMIN_BASE_URL') ?? '';
      const subject = `[LM FIT] Pedido aguardando pagamento InfinitePay (${order._id})`;
      const text = `Pedido público (InfinitePay).\nCliente: ${customerId}\nTotal: ${order.total}\nAdmin: ${web}/orders`;
      await this.notify.sendStaffEmail(subject, text).catch(() => undefined);
      this.notify.logStaffAlert('order_draft_submitted', {
        orderId: String(order._id),
        draftToken: doc.sessionToken,
      });
      return {
        orderId: String(order._id),
        payment: {
          paymentId: String(pay._id),
          checkoutUrl: pay.checkoutUrl,
        },
      };
    }

    const order = await this.orders.create(tenantId, {
      customerId: String(customerId),
      channel: 'online',
      status: 'open',
      reference: referenceString,
      notes: notesParts.length ? notesParts.join('\n') : undefined,
      lines: lineInputs,
    });
    doc.orderId = order._id as Types.ObjectId;
    doc.status = 'submitted';
    await doc.save();
    const web = this.config.get<string>('WEB_ADMIN_BASE_URL') ?? '';
    const subject = `[LM FIT] Pedido aguardando revisão (${order._id})`;
    const text = `Novo pedido criado a partir de rascunho público.\nCliente: ${customerId}\nTotal: ${order.total}\nAdmin: ${web}/orders`;
    await this.notify.sendStaffEmail(subject, text).catch(() => undefined);
    this.notify.logStaffAlert('order_draft_submitted', {
      orderId: String(order._id),
      draftToken: doc.sessionToken,
    });
    return { orderId: String(order._id), draft: doc.toObject() };
  }

  async listForStaff(tenantId: string, page: number, limit: number) {
    const skip = skipFromPage(page, limit);
    const filter = { tenantId: new Types.ObjectId(tenantId) };
    const [items, total] = await Promise.all([
      this.draftModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.draftModel.countDocuments(filter).exec(),
    ]);
    return { items, total, page, limit };
  }

  async findAllDraftsForExport(tenantId: string) {
    return this.draftModel
      .find({ tenantId: new Types.ObjectId(tenantId) })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
  }

  serializeDraftRow(doc: Record<string, unknown>): Record<string, unknown> {
    const o: Record<string, unknown> = { ...doc };
    if (o._id) o._id = String(o._id);
    if (o.customerId) o.customerId = String(o.customerId);
    if (o.orderId) o.orderId = String(o.orderId);
    if (o.assignedSalesUserId) {
      o.assignedSalesUserId = String(o.assignedSalesUserId);
    }
    if (Array.isArray(o.lines)) {
      o.lines = JSON.stringify(o.lines);
    }
    if (o.createdAt instanceof Date) o.createdAt = o.createdAt.toISOString();
    if (o.updatedAt instanceof Date) o.updatedAt = o.updatedAt.toISOString();
    return o;
  }

  async exportDraftsBuffer(
    tenantId: string,
    format: 'xlsx' | 'csv',
  ): Promise<{ buffer: Buffer; filename: string; mime: string }> {
    const docs = await this.findAllDraftsForExport(tenantId);
    const rows = docs.map((d) =>
      this.serializeDraftRow(d as unknown as Record<string, unknown>),
    );
    const buffer =
      format === 'csv'
        ? this.excel.buildCsvBuffer(ORDER_DRAFT_EXPORT_COLUMNS, rows)
        : await this.excel.buildXlsxBuffer(
            'Rascunhos',
            ORDER_DRAFT_EXPORT_COLUMNS,
            rows,
          );
    return {
      buffer,
      filename: `order-drafts.${format === 'csv' ? 'csv' : 'xlsx'}`,
      mime:
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private parseDraftLines(
    raw: unknown,
  ): NonNullable<PublicPatchDraftDto['lines']> | undefined {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return undefined;
    }
    try {
      const parsed = JSON.parse(String(raw)) as unknown;
      if (!Array.isArray(parsed)) {
        throw new BadRequestException('lines deve ser array JSON');
      }
      return parsed as NonNullable<PublicPatchDraftDto['lines']>;
    } catch {
      throw new BadRequestException('lines JSON inválido');
    }
  }

  async importDraftsFromJson(
    tenantId: string,
    items: Record<string, unknown>[],
    dryRun: boolean,
  ): Promise<StaffImportResponse> {
    return this.importDraftRecords(tenantId, items, dryRun);
  }

  async importDraftsFromXlsx(
    tenantId: string,
    buffer: Buffer,
    dryRun: boolean,
  ): Promise<StaffImportResponse> {
    const records = await this.excel.parseFirstSheetToRecords(
      buffer,
      orderDraftImportHeaderAliases(),
    );
    return this.importDraftRecords(tenantId, records, dryRun);
  }

  private async importDraftRecords(
    tenantId: string,
    items: Record<string, unknown>[],
    dryRun: boolean,
  ): Promise<StaffImportResponse> {
    const errors: { row: number; message: string }[] = [];
    let imported = 0;
    let updated = 0;
    const skipped = 0;

    for (let i = 0; i < items.length; i++) {
      const rowNum = i + 1;
      try {
        const row = items[i];
        const sessionToken = String(row.sessionToken ?? '').trim();
        const lines = this.parseDraftLines(row.lines);
        const dto: StaffPatchOrderDraftDto = {};
        if (lines) dto.lines = lines;
        if (row.status !== undefined && String(row.status).trim()) {
          dto.status = row.status as StaffPatchOrderDraftDto['status'];
        }
        if (row.paymentMethodChoice !== undefined) {
          dto.paymentMethodChoice = String(row.paymentMethodChoice).trim();
        }
        if (row.customerId !== undefined) {
          const c = String(row.customerId ?? '').trim();
          dto.customerId = c && Types.ObjectId.isValid(c) ? c : undefined;
        }
        if (row.waId !== undefined) {
          dto.waId = String(row.waId ?? '').trim();
        }
        if (row.assignedSalesUserId !== undefined) {
          const a = String(row.assignedSalesUserId ?? '').trim();
          dto.assignedSalesUserId =
            a && Types.ObjectId.isValid(a) ? a : undefined;
        }

        if (dryRun) {
          if (sessionToken.length >= 16) {
            const doc = await this.draftModel
              .findOne({ sessionToken, tenantId: new Types.ObjectId(tenantId) })
              .lean()
              .exec();
            if (!doc) {
              errors.push({
                row: rowNum,
                message: `sessionToken não encontrado: ${sessionToken}`,
              });
            }
          }
          continue;
        }

        if (sessionToken.length >= 16) {
          const exists = await this.draftModel
            .findOne({ sessionToken, tenantId: new Types.ObjectId(tenantId) })
            .exec();
          if (!exists) {
            errors.push({
              row: rowNum,
              message: `sessionToken não encontrado: ${sessionToken}`,
            });
            continue;
          }
          if (Object.keys(dto).length === 0) {
            continue;
          }
          await this.patchForStaff(tenantId, sessionToken, dto);
          updated++;
        } else {
          const create: PublicCreateDraftDto = {
            customerId:
              row.customerId !== undefined
                ? String(row.customerId).trim()
                : undefined,
            waId: row.waId !== undefined ? String(row.waId).trim() : undefined,
          };
          await this.createPublic(tenantId, create);
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
}
