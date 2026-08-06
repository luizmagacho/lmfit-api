import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, type OrderDocument } from '../orders/schemas/order.schema';
import { Customer } from '../customers/schemas/customer.schema';
import { Payment } from '../payments/schemas/payment.schema';
import { ProductsService } from '../products/products.service';
import { TenantsService } from '../tenants/tenants.service';
import { NotificationsService } from '../notifications/notifications.service';
import { skipFromPage } from '../common/dto/pagination-query.dto';
import { CreateReturnDto, CreateReturnRequestDto, ReturnLineInputDto } from './dto/create-return.dto';
import { ReturnRecord } from './schemas/return.schema';

const RETURNABLE_STATUSES = ['shipped', 'completed'];
const DEFAULT_WINDOW_DAYS = 30;

type BuiltLine = { variantId: Types.ObjectId; quantity: number; unitPrice: number; reason?: string };

@Injectable()
export class ReturnsService {
  constructor(
    @InjectModel(ReturnRecord.name) private readonly model: Model<ReturnRecord>,
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    @InjectModel(Customer.name) private readonly customerModel: Model<Customer>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    private readonly products: ProductsService,
    private readonly tenants: TenantsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Valida as linhas pedidas contra o estado ATUAL do pedido (nunca confia em dados guardados de
   *  uma solicitação anterior) — chamado tanto na criação imediata (staff) quanto na aprovação de
   *  uma solicitação (cliente), garantindo que a devolução real reflete o estoque/quantidade
   *  disponível no momento em que o efeito é de fato aplicado. */
  private validateAndBuildLines(
    order: OrderDocument,
    lines: ReturnLineInputDto[],
  ): { builtLines: BuiltLine[]; creditTotal: number } {
    const lineIndexByVariant = new Map<string, number>();
    order.lines.forEach((l, idx) => lineIndexByVariant.set(String(l.variantId), idx));

    const builtLines: BuiltLine[] = [];
    let creditTotal = 0;

    for (const input of lines) {
      const idx = lineIndexByVariant.get(input.variantId);
      if (idx === undefined) {
        throw new BadRequestException(`Variante ${input.variantId} não faz parte deste pedido`);
      }
      const orderLine = order.lines[idx];
      if (orderLine.isOrder) {
        throw new BadRequestException(
          `Linha de encomenda (${input.variantId}) nunca deduziu estoque — não pode ser devolvida`,
        );
      }
      const alreadyReturned = orderLine.returnedQty ?? 0;
      const available = orderLine.quantity - alreadyReturned;
      if (input.quantity > available) {
        throw new BadRequestException(
          `Quantidade a devolver (${input.quantity}) maior que a disponível para a variante ${input.variantId} (disponível: ${available})`,
        );
      }
      builtLines.push({
        variantId: new Types.ObjectId(input.variantId),
        quantity: input.quantity,
        unitPrice: orderLine.unitPrice,
        reason: input.reason,
      });
      creditTotal += orderLine.unitPrice * input.quantity;
    }

    return { builtLines, creditTotal };
  }

  /** Reverte estoque + aplica o efeito monetário conforme `type` — a única implementação desses
   *  efeitos, chamada tanto pela criação imediata do staff quanto pela aprovação de uma
   *  solicitação do cliente, para nunca divergir entre os dois caminhos.
   *  - 'return': credita `storeCreditBalance`.
   *  - 'refund' (Loop 17): marca o `Payment` pago mais recente do pedido como estornado
   *    (`refundedAt`/`refundAmount`/`refundedBy`) — sem crédito, sem chamada de API de estorno.
   *  - 'exchange': só estoque, sem efeito monetário. */
  private async applyReturnEffects(
    tenantId: string,
    order: OrderDocument,
    builtLines: BuiltLine[],
    type: 'return' | 'exchange' | 'refund',
    createdBy?: string,
  ): Promise<number> {
    for (const line of builtLines) {
      const idx = order.lines.findIndex((l) => String(l.variantId) === String(line.variantId));
      order.lines[idx].returnedQty = (order.lines[idx].returnedQty ?? 0) + line.quantity;
      await this.products.applyStockMovementWithOrderMeta(
        tenantId,
        String(line.variantId),
        { delta: line.quantity, reason: 'return', note: `Devolução pedido ${order._id}` },
        createdBy,
        order._id as Types.ObjectId,
      );
    }

    await order.save();

    const creditTotal = builtLines.reduce((acc, l) => acc + l.unitPrice * l.quantity, 0);
    if (type === 'return' && creditTotal > 0) {
      await this.customerModel
        .findOneAndUpdate(
          { _id: order.customerId, tenantId: new Types.ObjectId(tenantId) },
          { $inc: { storeCreditBalance: creditTotal } },
        )
        .exec();
    }
    if (type === 'refund' && creditTotal > 0) {
      await this.paymentModel
        .findOneAndUpdate(
          { tenantId: new Types.ObjectId(tenantId), orderId: order._id, status: 'paid' },
          {
            $set: {
              refundedAt: new Date(),
              refundAmount: creditTotal,
              refundedBy: createdBy ? new Types.ObjectId(createdBy) : undefined,
            },
          },
          { sort: { paidAt: -1 } },
        )
        .exec();
    }
    return type === 'exchange' ? 0 : creditTotal;
  }

  private async loadReturnableOrder(tenantId: string, orderId: string): Promise<OrderDocument> {
    if (!Types.ObjectId.isValid(orderId)) throw new NotFoundException();
    const order = await this.orderModel
      .findOne({ _id: orderId, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!order) throw new NotFoundException();
    if (!RETURNABLE_STATUSES.includes(order.status)) {
      throw new BadRequestException(
        'Só é possível devolver/trocar pedidos entregues ou concluídos (estoque precisa ter sido deduzido).',
      );
    }
    return order;
  }

  /** Linhas com saldo devolvível — exclui encomenda (nunca deduziu estoque) e linhas já totalmente
   *  devolvidas. Mesmo filtro que `ReturnsClient.tsx` (staff) já aplica no cliente, agora do lado
   *  servidor para as respostas de lookup/solicitação. */
  returnableLinesOf(order: OrderDocument) {
    return order.lines
      .filter((l) => !l.isOrder && l.quantity - (l.returnedQty ?? 0) > 0)
      .map((l) => ({
        variantId: String(l.variantId),
        description: l.description,
        quantity: l.quantity,
        returnedQty: l.returnedQty ?? 0,
        remaining: l.quantity - (l.returnedQty ?? 0),
        unitPrice: l.unitPrice,
      }));
  }

  private async assertWithinReturnWindow(tenantId: string, order: OrderDocument): Promise<void> {
    const tenant = await this.tenants.findById(tenantId);
    const windowDays = tenant?.storefront?.returnPolicy?.windowDays ?? DEFAULT_WINDOW_DAYS;
    const orderCreatedAt = (order as unknown as { createdAt: Date }).createdAt;
    const daysSince = (Date.now() - new Date(orderCreatedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > windowDays) {
      throw new BadRequestException(
        `O prazo para solicitar troca ou devolução deste pedido (${windowDays} dias) já passou.`,
      );
    }
  }

  /** Caminho já existente (staff, admin `/returns`) — executa na hora, `status` nasce
   *  `'completed'`. Comportamento inalterado por este loop. */
  async create(tenantId: string, orderId: string, dto: CreateReturnDto, createdBy?: string) {
    const order = await this.loadReturnableOrder(tenantId, orderId);
    const { builtLines } = this.validateAndBuildLines(order, dto.lines);
    // `creditIssued` reflete o valor monetário do efeito de fato aplicado por `applyReturnEffects`
    // (crédito de loja para 'return', valor estornado para 'refund', 0 para 'exchange') — nunca
    // recalculado localmente de novo, pra nunca divergir do que realmente aconteceu.
    const creditIssued = await this.applyReturnEffects(tenantId, order, builtLines, dto.type, createdBy);

    const created = await this.model.create({
      tenantId: new Types.ObjectId(tenantId),
      orderId: order._id,
      customerId: order.customerId,
      type: dto.type,
      lines: builtLines,
      creditIssued,
      notes: dto.notes,
      createdBy: createdBy ? new Types.ObjectId(createdBy) : undefined,
      status: 'completed',
      requestedBy: 'staff',
    });

    return created.toObject();
  }

  /** Novo caminho (Loop 8): solicitação do cliente (guest via `/devolucoes` ou logado via
   *  `/me/returns`) — valida elegibilidade + janela, cria com `status: 'requested'`, sem aplicar
   *  nenhum efeito ainda. Alerta o staff (mesmo padrão de `order-drafts.service.ts`). */
  /** Resolve o pedido para o fluxo guest (`/devolucoes`): número + telefone precisam bater com o
   *  `Customer` do pedido. Erro genérico em qualquer descompasso — nunca revela se o número existe. */
  async resolveOrderForGuest(tenantId: string, orderNumber: number, phone: string): Promise<OrderDocument> {
    const normalizedPhone = phone.replace(/\D/g, '');
    const order = await this.orderModel
      .findOne({ tenantId: new Types.ObjectId(tenantId), number: orderNumber })
      .exec();
    if (!order) throw new NotFoundException('Pedido não encontrado. Confira o número e o telefone.');
    const customer = await this.customerModel
      .findOne({ _id: order.customerId, tenantId: new Types.ObjectId(tenantId) })
      .lean()
      .exec();
    const customerPhone = customer?.phone?.replace(/\D/g, '') ?? '';
    if (!customerPhone || customerPhone !== normalizedPhone) {
      throw new NotFoundException('Pedido não encontrado. Confira o número e o telefone.');
    }
    return order;
  }

  async requestFromCustomer(
    tenantId: string,
    customerId: string,
    orderId: string,
    dto: CreateReturnRequestDto,
  ) {
    const order = await this.loadReturnableOrder(tenantId, orderId);
    if (String(order.customerId) !== String(customerId)) {
      throw new ForbiddenException('Este pedido não pertence a este cliente.');
    }
    await this.assertWithinReturnWindow(tenantId, order);
    // Valida contra o estado atual só para dar um erro cedo e claro ao cliente — a validação que
    // realmente importa (defesa em profundidade) roda de novo em `approve()`, contra o estado do
    // pedido no momento em que o efeito é aplicado, não no momento da solicitação.
    this.validateAndBuildLines(order, dto.lines);

    const created = await this.model.create({
      tenantId: new Types.ObjectId(tenantId),
      orderId: order._id,
      customerId: order.customerId,
      type: dto.type,
      lines: dto.lines.map((l) => ({ variantId: new Types.ObjectId(l.variantId), quantity: l.quantity, unitPrice: 0, reason: l.reason })),
      notes: dto.notes,
      status: 'requested',
      requestedBy: 'customer',
      desiredVariantId: dto.desiredVariantId ? new Types.ObjectId(dto.desiredVariantId) : undefined,
    });

    this.notifications.logStaffAlert('return_requested', {
      tenantId,
      orderId: String(order._id),
      orderNumber: order.number,
      returnId: String(created._id),
      type: dto.type,
    });

    return created.toObject();
  }

  async findAllForCustomer(tenantId: string, customerId: string) {
    return this.model
      .find({ tenantId: new Types.ObjectId(tenantId), customerId: new Types.ObjectId(customerId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  /** Staff aprova uma solicitação (`status: 'requested'` → `'completed'`): revalida contra o
   *  estado atual do pedido e só então aplica o efeito (estoque + crédito). */
  async approve(tenantId: string, returnId: string, staffUserId: string) {
    if (!Types.ObjectId.isValid(returnId)) throw new NotFoundException();
    const record = await this.model
      .findOne({ _id: returnId, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!record) throw new NotFoundException();
    if (record.status !== 'requested') {
      throw new BadRequestException('Esta solicitação já foi avaliada.');
    }

    const order = await this.orderModel
      .findOne({ _id: record.orderId, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!order) throw new NotFoundException();

    const { builtLines } = this.validateAndBuildLines(
      order,
      record.lines.map((l) => ({ variantId: String(l.variantId), quantity: l.quantity, reason: l.reason })),
    );
    const creditTotal = await this.applyReturnEffects(tenantId, order, builtLines, record.type, staffUserId);

    record.lines = builtLines;
    record.creditIssued = creditTotal;
    record.status = 'completed';
    record.reviewedBy = new Types.ObjectId(staffUserId);
    record.reviewedAt = new Date();
    await record.save();

    await this.notifyCustomer(tenantId, record.customerId, order.number, 'approved');

    return record.toObject();
  }

  async reject(tenantId: string, returnId: string, staffUserId: string, note?: string) {
    if (!Types.ObjectId.isValid(returnId)) throw new NotFoundException();
    const record = await this.model
      .findOne({ _id: returnId, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!record) throw new NotFoundException();
    if (record.status !== 'requested') {
      throw new BadRequestException('Esta solicitação já foi avaliada.');
    }

    const order = await this.orderModel
      .findOne({ _id: record.orderId, tenantId: new Types.ObjectId(tenantId) })
      .exec();

    record.status = 'rejected';
    record.rejectionNote = note;
    record.reviewedBy = new Types.ObjectId(staffUserId);
    record.reviewedAt = new Date();
    await record.save();

    await this.notifyCustomer(tenantId, record.customerId, order?.number, 'rejected', note);

    return record.toObject();
  }

  private async notifyCustomer(
    tenantId: string,
    customerId: Types.ObjectId,
    orderNumber: number | undefined,
    outcome: 'approved' | 'rejected',
    note?: string,
  ) {
    const customer = await this.customerModel
      .findOne({ _id: customerId, tenantId: new Types.ObjectId(tenantId) })
      .lean()
      .exec();
    if (!customer?.email) return;
    const subject =
      outcome === 'approved'
        ? `Sua solicitação de troca/devolução (pedido #${orderNumber}) foi aprovada`
        : `Sua solicitação de troca/devolução (pedido #${orderNumber}) foi recusada`;
    const text =
      outcome === 'approved'
        ? `Boa notícia! Sua solicitação para o pedido #${orderNumber} foi aprovada e já foi processada.`
        : `Sua solicitação para o pedido #${orderNumber} foi recusada.${note ? ` Motivo: ${note}` : ''}`;
    try {
      await this.notifications.sendEmail(customer.email, subject, text);
    } catch {
      // Falha de entrega é uma preocupação de infraestrutura separada — mesma postura do Loop 7
      // (magic link): não deixamos a aprovação/rejeição falhar por causa do e-mail.
    }
  }

  async findAllForOrder(tenantId: string, orderId: string) {
    return this.model
      .find({ tenantId: new Types.ObjectId(tenantId), orderId: new Types.ObjectId(orderId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async findAll(tenantId: string, page: number, limit: number, status?: string) {
    const skip = skipFromPage(page, limit);
    const filter: Record<string, unknown> = { tenantId: new Types.ObjectId(tenantId) };
    if (status) filter.status = status;
    const [rows, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate<{ orderId: { _id: Types.ObjectId; number: number; reference?: string } }>('orderId', 'number reference')
        .populate<{ customerId: { _id: Types.ObjectId; name: string } }>('customerId', 'name')
        .lean()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    const items = rows.map((r) => ({
      ...r,
      orderNumber: r.orderId?.number,
      orderReference: r.orderId?.reference,
      customerName: r.customerId?.name,
      orderId: r.orderId?._id ?? r.orderId,
      customerId: r.customerId?._id ?? r.customerId,
    }));
    return { items, total, page, limit };
  }
}
