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
import { PromotionsService } from '../promotions/promotions.service';
import { TenantsService } from '../tenants/tenants.service';
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
    private readonly promotions: PromotionsService,
    private readonly notify: NotificationsService,
    private readonly config: ConfigService,
    private readonly excel: ExcelSpreadsheetService,
    private readonly tenants: TenantsService,
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
  ): Promise<{ lines: OrderDraft['lines']; usesWholesale: boolean }> {
    if (!lines?.length) return { lines: [], usesWholesale: false };
    for (const line of lines) {
      if (!Types.ObjectId.isValid(line.variantId)) {
        throw new BadRequestException('Invalid variant');
      }
    }
    // Batch both lookups (variants + their wholesale pricing) instead of two round-trips
    // per line — a cart of 20 items previously meant ~40 sequential queries here.
    const variantIds = lines.map((l) => l.variantId);
    const variants = await this.variantModel
      .find({ _id: { $in: variantIds }, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    const variantById = new Map(variants.map((v) => [String(v._id), v]));
    const pricingByVariant = await this.products.getWholesalePricingBatch(tenantId, variantIds);

    const built: OrderDraft['lines'] = [];
    let usesWholesale = false;
    for (const line of lines) {
      const v = variantById.get(line.variantId);
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
      const pricing = pricingByVariant.get(String(v._id));
      const isWholesaleLine = !!(pricing && line.quantity >= pricing.minWholesaleQty);
      if (isWholesaleLine) usesWholesale = true;
      const unitPrice = isWholesaleLine ? pricing!.priceWholesale : (pricing?.priceRetail ?? v.price ?? 0);
      built.push({
        variantId: v._id as Types.ObjectId,
        quantity: line.quantity,
        unitPrice,
        isOrder,
      });
    }
    return { lines: built, usesWholesale };
  }

  /** Cupom é mutuamente exclusivo com preço de atacado nesta v1 — evita empilhar dois descontos. */
  private async cartUsesWholesale(tenantId: string, lines: OrderDraft['lines']): Promise<boolean> {
    if (!lines.length) return false;
    const pricingByVariant = await this.products.getWholesalePricingBatch(
      tenantId,
      lines.map((l) => String(l.variantId)),
    );
    return lines.some((l) => {
      const pricing = pricingByVariant.get(String(l.variantId));
      return !!(pricing && l.quantity >= pricing.minWholesaleQty);
    });
  }

  private async applyDraftPatch(
    tenantId: string,
    doc: OrderDraftDocument,
    dto: StaffPatchOrderDraftDto,
    allowWhenLocked: boolean,
    enforceStock: boolean,
    allowBackorder: boolean,
    trustClientShipping: boolean,
  ): Promise<void> {
    this.assertDraftPatchable(doc, allowWhenLocked);
    if (dto.lines) {
      const rebuilt = await this.rebuildLinesFromDto(tenantId, dto.lines, enforceStock, allowBackorder);
      doc.lines = rebuilt.lines;
    }
    if (dto.status !== undefined) doc.status = dto.status;
    if (dto.paymentMethodChoice !== undefined) {
      doc.paymentMethodChoice = dto.paymentMethodChoice;
    }
    if (dto.shippingMethod !== undefined) {
      doc.shippingMethod = dto.shippingMethod;
    }
    if (trustClientShipping) {
      // Staff/admin editando um rascunho manualmente pode arbitrar um valor de frete (ex.:
      // cotação combinada por telefone) — só o comprador anônimo nunca tem esse valor aceito.
      if (dto.shippingCost !== undefined) {
        doc.shippingCost = dto.shippingCost;
      }
    } else if (dto.shippingMethod !== undefined) {
      doc.shippingCost = await this.computeShippingCost(tenantId, dto.shippingMethod, doc.lines);
    }
    if (dto.couponCode !== undefined) {
      const code = dto.couponCode.trim();
      if (!code) {
        doc.couponCode = undefined;
        doc.discountTotal = 0;
      } else {
        const usesWholesale = await this.cartUsesWholesale(tenantId, doc.lines);
        if (usesWholesale) {
          throw new BadRequestException('Cupom não pode ser combinado com preço de atacado');
        }
        const subtotal = doc.lines.reduce((acc, l) => acc + l.unitPrice * l.quantity, 0);
        const { discountAmount } = await this.promotions.validateAndComputeDiscount(tenantId, code, subtotal);
        doc.couponCode = code.toUpperCase();
        doc.discountTotal = discountAmount;
      }
    } else if (dto.lines && doc.couponCode) {
      // Linhas mudaram sem mexer no cupom — revalida contra o novo subtotal.
      // Se o cupom não qualifica mais (ex.: caiu abaixo do mínimo), remove em silêncio
      // em vez de travar a atualização do carrinho.
      try {
        const usesWholesale = await this.cartUsesWholesale(tenantId, doc.lines);
        if (usesWholesale) throw new BadRequestException('wholesale conflict');
        const subtotal = doc.lines.reduce((acc, l) => acc + l.unitPrice * l.quantity, 0);
        const { discountAmount } = await this.promotions.validateAndComputeDiscount(
          tenantId,
          doc.couponCode,
          subtotal,
        );
        doc.discountTotal = discountAmount;
      } catch {
        doc.couponCode = undefined;
        doc.discountTotal = 0;
      }
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

  /**
   * Frete v1 (Loop 3): taxa fixa por método, isenção acima de um subtotal — nunca aceita o valor
   * vindo do comprador (ver Decisions do spec). `pickup` é sempre grátis; a isenção incide sobre o
   * subtotal de produtos, antes do desconto Pix (mesma base que o cupom usa).
   */
  private async computeShippingCost(
    tenantId: string,
    method: 'pickup' | 'standard' | 'express',
    lines: OrderDraft['lines'],
  ): Promise<number> {
    if (method === 'pickup') return 0;
    const tenant = await this.tenants.findById(tenantId);
    const cfg = tenant?.shippingConfig;
    const fee = method === 'express' ? (cfg?.expressFee ?? 39.9) : (cfg?.standardFee ?? 19.9);
    const threshold = cfg?.freeAboveTotal;
    if (threshold && threshold > 0) {
      const subtotal = lines.reduce((acc, l) => acc + l.unitPrice * l.quantity, 0);
      if (subtotal >= threshold) return 0;
    }
    return fee;
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
    await this.applyDraftPatch(tenantId, doc, dto as StaffPatchOrderDraftDto, false, true, allowBackorder, false);
    await doc.save();
    return doc.toObject();
  }

  async patchForStaff(tenantId: string, token: string, dto: StaffPatchOrderDraftDto) {
    const t = this.normalizeToken(token);
    const doc = await this.draftModel
      .findOne({ sessionToken: t, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!doc) throw new NotFoundException();
    await this.applyDraftPatch(tenantId, doc, dto, true, false, true, true);
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

  private async applyPixDiscount<T extends { unitPrice: number }>(
    tenantId: string,
    lineInputs: T[],
  ): Promise<T[]> {
    const tenant = await this.tenants.findById(tenantId);
    const pct = tenant?.pricingDisplay?.pixDiscountPercent ?? 0;
    if (!(pct > 0)) return lineInputs;
    const factor = 1 - pct / 100;
    return lineInputs.map((l) => ({ ...l, unitPrice: Math.round(l.unitPrice * factor * 100) / 100 }));
  }

  /**
   * Crédito de loja (Loop 9) — dedução final tipo vale-presente, aplicada por cima do subtotal já
   * líquido de cupom e (se for o caso) do desconto Pix daquele branch específico. Recalcula e
   * deduz atomicamente contra o saldo real no momento do submit (nunca confia num valor mostrado
   * na UI minutos antes) — mesma postura de "revalidar contra o estado ao vivo" do Loop 8.
   */
  private async applyStoreCreditForSubmit(
    tenantId: string,
    customerId: string,
    useStoreCredit: boolean | undefined,
    lineInputsForBranch: Array<{ unitPrice: number; quantity: number }>,
    shippingCost: number,
    discountTotal: number,
  ): Promise<number> {
    if (!useStoreCredit) return 0;
    const subtotal = lineInputsForBranch.reduce((acc, l) => acc + l.unitPrice * l.quantity, 0);
    const totalBeforeCredit = Math.max(0, subtotal + (shippingCost ?? 0) - (discountTotal ?? 0));
    return this.customers.applyStoreCredit(tenantId, customerId, totalBeforeCredit);
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
        const email = custData.email ? String(custData.email).trim() : undefined;
        // Dá preferência ao e-mail: é a mesma chave que o login por magic link (Loop 7) usa para
        // resolver o Customer, então uma compra feita como convidado com um e-mail que já tem
        // conta aparece em "meus pedidos" sem nenhuma migração/vínculo manual.
        const existing = email
          ? await this.customers.findByEmail(tenantId, email)
          : waId
            ? await this.customers.findByWaId(tenantId, waId)
            : null;
        if (existing) {
          customerId = existing._id;
        } else {
          const newCustomer = await this.customers.create(tenantId, {
            name: String(custData.name).trim(),
            phone: custData.phone ? String(custData.phone).trim() : undefined,
            email,
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
        const totalVal =
          doc.lines.reduce((acc, l) => acc + (l.unitPrice * l.quantity), 0) +
          (doc.shippingCost ?? 0) -
          (doc.discountTotal ?? 0);
        const fmtTotal = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalVal);
        referenceString = `WhatsApp: ${custData.name} - ${custData.phone} - ${fmtTotal}`;
      }
    }

    // A confirmação atômica do cupom (redeem) acontece dentro de OrdersService.create(),
    // não aqui — é o mesmo chokepoint usado pela criação direta de pedido no admin/PDV,
    // então o uso nunca é contado duas vezes nem pulado por um dos dois caminhos.

    if (body?.payment?.method === 'pix') {
      // Preço "à vista no Pix" cobrado = preço exibido na loja (usePricingRules no web, mesma
      // fórmula). Só incide sobre o subtotal de produtos (frete fica de fora, como a maioria das
      // lojas BR faz) e não combina com cupom nesta v1 — evita empilhar dois descontos calculados
      // sobre bases diferentes; a linha do cupom já foi validada contra o preço cheio no patch.
      const pixLineInputs = doc.couponCode ? lineInputs : await this.applyPixDiscount(tenantId, lineInputs);
      const creditApplied = await this.applyStoreCreditForSubmit(
        tenantId,
        String(customerId),
        body?.useStoreCredit,
        pixLineInputs,
        doc.shippingCost,
        doc.discountTotal,
      );
      const order = await this.orders.create(
        tenantId,
        {
          customerId: String(customerId),
          channel: 'online',
          status: 'open',
          reference: referenceString,
          notes: notesParts.length ? notesParts.join('\n') : undefined,
          lines: pixLineInputs,
          shippingMethod: doc.shippingMethod,
          shippingCost: doc.shippingCost,
          couponCode: doc.couponCode,
          discountTotal: doc.discountTotal,
          creditApplied,
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
      const creditApplied = await this.applyStoreCreditForSubmit(
        tenantId,
        String(customerId),
        body?.useStoreCredit,
        lineInputs,
        doc.shippingCost,
        doc.discountTotal,
      );
      const order = await this.orders.create(
        tenantId,
        {
          customerId: String(customerId),
          channel: 'online',
          status: 'open',
          reference: referenceString,
          notes: notesParts.length ? notesParts.join('\n') : undefined,
          lines: lineInputs,
          shippingMethod: doc.shippingMethod,
          shippingCost: doc.shippingCost,
          couponCode: doc.couponCode,
          discountTotal: doc.discountTotal,
          creditApplied,
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

    const manualCreditApplied = await this.applyStoreCreditForSubmit(
      tenantId,
      String(customerId),
      body?.useStoreCredit,
      lineInputs,
      doc.shippingCost,
      doc.discountTotal,
    );
    const order = await this.orders.create(tenantId, {
      customerId: String(customerId),
      channel: 'online',
      status: 'open',
      reference: referenceString,
      notes: notesParts.length ? notesParts.join('\n') : undefined,
      lines: lineInputs,
      shippingMethod: doc.shippingMethod,
      shippingCost: doc.shippingCost,
      couponCode: doc.couponCode,
      discountTotal: doc.discountTotal,
      creditApplied: manualCreditApplied,
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
