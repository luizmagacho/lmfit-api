import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order } from '../orders/schemas/order.schema';
import { Customer } from '../customers/schemas/customer.schema';
import { ProductsService } from '../products/products.service';
import { skipFromPage } from '../common/dto/pagination-query.dto';
import { CreateReturnDto } from './dto/create-return.dto';
import { ReturnRecord } from './schemas/return.schema';

const RETURNABLE_STATUSES = ['shipped', 'completed'];

@Injectable()
export class ReturnsService {
  constructor(
    @InjectModel(ReturnRecord.name) private readonly model: Model<ReturnRecord>,
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    @InjectModel(Customer.name) private readonly customerModel: Model<Customer>,
    private readonly products: ProductsService,
  ) {}

  async create(tenantId: string, orderId: string, dto: CreateReturnDto, createdBy?: string) {
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

    const lineIndexByVariant = new Map<string, number>();
    order.lines.forEach((l, idx) => lineIndexByVariant.set(String(l.variantId), idx));

    const builtLines: Array<{ variantId: Types.ObjectId; quantity: number; unitPrice: number; reason?: string }> = [];
    let creditTotal = 0;

    for (const input of dto.lines) {
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
      order.lines[idx].returnedQty = alreadyReturned + input.quantity;
    }

    // Reverte estoque linha a linha — mesmo decremento/incremento atômico usado na venda,
    // evita corrida entre duas devoluções concorrentes da mesma variante.
    for (const line of builtLines) {
      await this.products.applyStockMovementWithOrderMeta(
        tenantId,
        String(line.variantId),
        { delta: line.quantity, reason: 'return', note: `Devolução pedido ${orderId}` },
        createdBy,
        order._id as Types.ObjectId,
      );
    }

    await order.save();

    if (dto.type === 'return' && creditTotal > 0) {
      await this.customerModel
        .findOneAndUpdate(
          { _id: order.customerId, tenantId: new Types.ObjectId(tenantId) },
          { $inc: { storeCreditBalance: creditTotal } },
        )
        .exec();
    }

    const created = await this.model.create({
      tenantId: new Types.ObjectId(tenantId),
      orderId: order._id,
      customerId: order.customerId,
      type: dto.type,
      lines: builtLines,
      creditIssued: dto.type === 'return' ? creditTotal : 0,
      notes: dto.notes,
      createdBy: createdBy ? new Types.ObjectId(createdBy) : undefined,
    });

    return created.toObject();
  }

  async findAllForOrder(tenantId: string, orderId: string) {
    return this.model
      .find({ tenantId: new Types.ObjectId(tenantId), orderId: new Types.ObjectId(orderId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async findAll(tenantId: string, page: number, limit: number) {
    const skip = skipFromPage(page, limit);
    const filter = { tenantId: new Types.ObjectId(tenantId) };
    const [items, total] = await Promise.all([
      this.model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items, total, page, limit };
  }
}
