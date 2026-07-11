import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { skipFromPage } from '../common/dto/pagination-query.dto';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateLeadDto } from './dto/create-lead.dto';
import type { UpdateLeadDto } from './dto/update-lead.dto';
import { ProductLead } from './schemas/product-lead.schema';

@Injectable()
export class LeadsService {
  constructor(
    @InjectModel(ProductLead.name) private readonly model: Model<ProductLead>,
    private readonly notify: NotificationsService,
  ) {}

  async createFromChat(tenantId: string, dto: CreateLeadDto) {
    const doc = await this.model.create({
      tenantId: new Types.ObjectId(tenantId),
      customerName: dto.customerName,
      customerPhone: dto.customerPhone,
      productDescription: dto.productDescription,
      status: 'new',
      source: 'chat',
    });

    const subject = `[Kivoni] Pedido de produto fora do catálogo`;
    const text = `Cliente: ${dto.customerName}\nTelefone: ${dto.customerPhone}\nProduto pedido: ${dto.productDescription}\n\nO cliente pediu algo que a loja não tem cadastrado — entre em contato para negociar/providenciar.`;
    await this.notify.sendStaffEmail(subject, text).catch(() => undefined);
    this.notify.logStaffAlert('product_lead_created', {
      leadId: String(doc._id),
      customerPhone: dto.customerPhone,
    });

    return doc.toObject();
  }

  async listForStaff(tenantId: string, page: number, limit: number) {
    const skip = skipFromPage(page, limit);
    const filter = { tenantId: new Types.ObjectId(tenantId) };
    const [items, total] = await Promise.all([
      this.model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items, total, page, limit };
  }

  async updateStatus(tenantId: string, id: string, dto: UpdateLeadDto) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model
      .findOneAndUpdate(
        { _id: id, tenantId: new Types.ObjectId(tenantId) },
        { $set: { status: dto.status } },
        { new: true },
      )
      .lean()
      .exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }
}
