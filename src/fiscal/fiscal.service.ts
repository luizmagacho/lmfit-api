import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order } from '../orders/schemas/order.schema';
import { ProductVariant } from '../products/schemas/product-variant.schema';
import { TenantsService } from '../tenants/tenants.service';
import { FocusNfeAdapter } from './adapters/focus-nfe.adapter';
import { FiscalDocument, FiscalDocumentDocument } from './schemas/fiscal-document.schema';

@Injectable()
export class FiscalService {
  constructor(
    @InjectModel(FiscalDocument.name) private readonly model: Model<FiscalDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    @InjectModel(ProductVariant.name) private readonly variantModel: Model<ProductVariant>,
    private readonly tenants: TenantsService,
    private readonly focusNfe: FocusNfeAdapter,
  ) {}

  private async requireFiscalConfig(tenantId: string) {
    const tenant = await this.tenants.findById(tenantId);
    const fiscal = tenant?.fiscal;
    if (!fiscal?.cnpj || !fiscal?.focusNfeToken) {
      throw new BadRequestException(
        'Configuração fiscal incompleta: cadastre CNPJ e o token da Focus NFe em /tenants/:id/fiscal antes de emitir.',
      );
    }
    return fiscal;
  }

  async emitForOrder(tenantId: string, orderId: string): Promise<FiscalDocumentDocument> {
    if (!Types.ObjectId.isValid(orderId)) throw new NotFoundException();
    const fiscal = await this.requireFiscalConfig(tenantId);

    const order = await this.orderModel
      .findOne({ _id: orderId, tenantId: new Types.ObjectId(tenantId) })
      .lean()
      .exec();
    if (!order) throw new NotFoundException('Pedido não encontrado');
    if (!order.lines?.length) {
      throw new BadRequestException('Pedido sem itens não pode gerar nota fiscal');
    }

    const existing = await this.model
      .findOne({ tenantId: new Types.ObjectId(tenantId), orderId: order._id, status: { $in: ['authorized', 'processing'] } })
      .lean()
      .exec();
    if (existing) {
      throw new BadRequestException('Já existe uma nota fiscal emitida/em processamento para este pedido');
    }

    const variantIds = order.lines.map((l) => l.variantId);
    const variants = await this.variantModel.find({ _id: { $in: variantIds } }).lean().exec();
    const byId = new Map(variants.map((v) => [String(v._id), v]));

    const items = order.lines.map((line) => {
      const v = byId.get(String(line.variantId));
      return {
        descricao: line.description || `Produto ${v?.sku ?? String(line.variantId)}`,
        quantidade: line.quantity,
        valorUnitario: line.unitPrice,
      };
    });

    const doc = await this.model.create({
      tenantId: new Types.ObjectId(tenantId),
      orderId: order._id,
      type: 'nfce',
      status: 'processing',
      amount: order.total ?? 0,
    });

    const result = await this.focusNfe.emitNfce(
      {
        token: fiscal.focusNfeToken!,
        ambiente: fiscal.ambiente ?? 'homologacao',
        cnpj: fiscal.cnpj!,
      },
      { reference: `pedido-${String(order._id)}`, items, total: order.total ?? 0 },
    );

    if (result.ok) {
      doc.status = 'authorized';
      doc.providerId = result.providerId;
      doc.chaveAcesso = result.chaveAcesso;
      doc.qrCodeUrl = result.qrCodeUrl;
      doc.danfeUrl = result.danfeUrl;
      doc.emittedAt = new Date();
    } else {
      doc.status = 'error';
      doc.errorMessage = result.error;
    }
    await doc.save();
    return doc;
  }

  async getForOrder(tenantId: string, orderId: string) {
    if (!Types.ObjectId.isValid(orderId)) throw new NotFoundException();
    return this.model
      .find({ tenantId: new Types.ObjectId(tenantId), orderId: new Types.ObjectId(orderId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  /** Tenant-wide fiscal document history, most recent first. */
  async findAll(tenantId: string, page: number, limit: number) {
    const tid = new Types.ObjectId(tenantId);
    const skip = (page - 1) * limit;
    const [docs, total] = await Promise.all([
      this.model.find({ tenantId: tid }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
      this.model.countDocuments({ tenantId: tid }),
    ]);
    const orderIds = docs.map((d) => d.orderId);
    const orders = await this.orderModel
      .find({ _id: { $in: orderIds } })
      .select('number')
      .lean()
      .exec();
    const orderNumberById = new Map(orders.map((o) => [String(o._id), o.number]));
    const items = docs.map((d) => ({
      ...d,
      orderNumber: orderNumberById.get(String(d.orderId)) ?? null,
    }));
    return { items, total, page, limit };
  }
}
