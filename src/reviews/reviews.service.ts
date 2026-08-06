import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, type OrderStatus } from '../orders/schemas/order.schema';
import { ProductVariant } from '../products/schemas/product-variant.schema';
import { skipFromPage } from '../common/dto/pagination-query.dto';
import { Review } from './schemas/review.schema';
import type { CreateReviewDto } from './dto/create-review.dto';

/** Pedido precisa ter efetivamente saído (ou chegado) pra contar como compra verificada — um
 *  pedido só pago mas ainda não enviado não garante que o cliente já recebeu/experimentou o
 *  produto. */
const VERIFIED_PURCHASE_STATUSES: OrderStatus[] = ['shipped', 'completed'];

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private readonly model: Model<Review>,
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    @InjectModel(ProductVariant.name) private readonly variantModel: Model<ProductVariant>,
  ) {}

  private async assertVerifiedPurchase(
    tenantId: string,
    customerId: string,
    productId: string,
  ): Promise<Types.ObjectId> {
    const variantIds = (
      await this.variantModel
        .find({ tenantId: new Types.ObjectId(tenantId), productId: new Types.ObjectId(productId) })
        .select('_id')
        .lean()
        .exec()
    ).map((v) => v._id);
    if (!variantIds.length) throw new NotFoundException();

    const order = await this.orderModel
      .findOne({
        tenantId: new Types.ObjectId(tenantId),
        customerId: new Types.ObjectId(customerId),
        status: { $in: VERIFIED_PURCHASE_STATUSES },
        'lines.variantId': { $in: variantIds },
      })
      .select('_id')
      .lean()
      .exec();
    if (!order) {
      throw new ForbiddenException('Você só pode avaliar produtos de pedidos já enviados.');
    }
    return order._id as Types.ObjectId;
  }

  async createFromCustomer(tenantId: string, customerId: string, dto: CreateReviewDto) {
    const existing = await this.model
      .findOne({
        tenantId: new Types.ObjectId(tenantId),
        customerId: new Types.ObjectId(customerId),
        productId: new Types.ObjectId(dto.productId),
      })
      .lean()
      .exec();
    if (existing) {
      throw new BadRequestException('Você já avaliou este produto.');
    }

    const orderId = await this.assertVerifiedPurchase(tenantId, customerId, dto.productId);

    return this.model.create({
      tenantId: new Types.ObjectId(tenantId),
      productId: new Types.ObjectId(dto.productId),
      customerId: new Types.ObjectId(customerId),
      orderId,
      rating: dto.rating,
      comment: dto.comment,
    });
  }

  async listOwnForCustomer(tenantId: string, customerId: string) {
    return this.model
      .find({ tenantId: new Types.ObjectId(tenantId), customerId: new Types.ObjectId(customerId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async listApprovedForProduct(tenantId: string, productId: string) {
    if (!Types.ObjectId.isValid(productId)) return { items: [], average: 0, count: 0 };
    const match = {
      tenantId: new Types.ObjectId(tenantId),
      productId: new Types.ObjectId(productId),
      status: 'approved' as const,
    };
    const [items, agg] = await Promise.all([
      this.model
        .find(match)
        .populate<{ customerId: { name: string } }>('customerId', 'name')
        .sort({ createdAt: -1 })
        .lean()
        .exec(),
      this.model.aggregate([
        { $match: match },
        { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]),
    ]);
    const stats = agg[0] as { average?: number; count?: number } | undefined;
    return {
      items: items.map((r) => ({
        _id: r._id,
        rating: r.rating,
        comment: r.comment,
        createdAt: (r as { createdAt?: Date }).createdAt,
        customerName: (r.customerId as unknown as { name?: string })?.name ?? 'Cliente',
      })),
      average: stats?.average ?? 0,
      count: stats?.count ?? 0,
    };
  }

  async findAll(tenantId: string, page: number, limit: number, status?: string) {
    const match: Record<string, unknown> = { tenantId: new Types.ObjectId(tenantId) };
    if (status) match.status = status;
    const skip = skipFromPage(page, limit);
    const [items, total] = await Promise.all([
      this.model
        .find(match)
        .populate<{ customerId: { name: string } }>('customerId', 'name')
        .populate<{ productId: { name: string } }>('productId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.model.countDocuments(match).exec(),
    ]);
    return { items, total, page, limit };
  }

  async approve(tenantId: string, id: string, userId: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), tenantId: new Types.ObjectId(tenantId) },
        { $set: { status: 'approved', reviewedBy: new Types.ObjectId(userId), reviewedAt: new Date() } },
        { new: true },
      )
      .exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async reject(tenantId: string, id: string, userId: string, note?: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), tenantId: new Types.ObjectId(tenantId) },
        {
          $set: {
            status: 'rejected',
            reviewedBy: new Types.ObjectId(userId),
            reviewedAt: new Date(),
            rejectionNote: note,
          },
        },
        { new: true },
      )
      .exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }
}
