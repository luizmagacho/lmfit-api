import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { skipFromPage } from '../common/dto/pagination-query.dto';
import { escapeRegex } from '../common/utils/text-search.util';
import { Promotion } from '../promotions/schemas/promotion.schema';
import type { CreateInfluencerDto } from './dto/create-influencer.dto';
import type { UpdateInfluencerDto } from './dto/update-influencer.dto';
import { Influencer } from './schemas/influencer.schema';

@Injectable()
export class InfluencersService {
  constructor(
    @InjectModel(Influencer.name) private readonly model: Model<Influencer>,
    @InjectModel(Promotion.name) private readonly promotionModel: Model<Promotion>,
  ) {}

  async create(tenantId: string, dto: CreateInfluencerDto, createdBy?: string) {
    return this.model.create({
      ...dto,
      tenantId: new Types.ObjectId(tenantId),
      createdBy: createdBy ? new Types.ObjectId(createdBy) : undefined,
    });
  }

  async findAll(tenantId: string, page: number, limit: number, search?: string) {
    const skip = skipFromPage(page, limit);
    const q: Record<string, any> = { tenantId: new Types.ObjectId(tenantId) };
    if (search) {
      const safe = escapeRegex(search);
      q.$or = [
        { name: new RegExp(safe, 'i') },
        { instagramHandle: new RegExp(safe, 'i') },
        { email: new RegExp(safe, 'i') },
      ];
    }
    const [items, total] = await Promise.all([
      this.model.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.model.countDocuments(q).exec(),
    ]);
    return { items, total, page, limit };
  }

  async findOne(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model
      .findOne({ _id: new Types.ObjectId(id), tenantId: new Types.ObjectId(tenantId) })
      .lean()
      .exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async update(tenantId: string, id: string, dto: UpdateInfluencerDto) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), tenantId: new Types.ObjectId(tenantId) },
        dto,
        { new: true },
      )
      .lean()
      .exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }

  /** Recusa excluir se algum cupom desse influenciador já vendeu (`usedCount > 0`) — protege o
   *  histórico do relatório de vendas por influenciador (Loop C). Desativar (`active:false`)
   *  continua disponível via `update()` normalmente. */
  async remove(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const tenantObjectId = new Types.ObjectId(tenantId);
    const influencerObjectId = new Types.ObjectId(id);

    const usedPromotion = await this.promotionModel
      .findOne({ tenantId: tenantObjectId, influencerId: influencerObjectId, usedCount: { $gt: 0 } })
      .lean()
      .exec();
    if (usedPromotion) {
      throw new BadRequestException(
        'Este influenciador já tem cupons com vendas registradas — desative em vez de excluir, pra não perder o histórico do relatório.',
      );
    }

    const res = await this.model
      .findOneAndDelete({ _id: influencerObjectId, tenantId: tenantObjectId })
      .exec();
    if (!res) throw new NotFoundException();
    return { deleted: true };
  }
}
