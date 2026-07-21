import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Material, MaterialDocument } from './schemas/material.schema';
import { CreateMaterialDto } from './dto/create-material.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';
import { skipFromPage } from '../common/dto/pagination-query.dto';
import { escapeRegex } from '../common/utils/text-search.util';

@Injectable()
export class MaterialsService {
  constructor(
    @InjectModel(Material.name) private model: Model<MaterialDocument>,
  ) {}

  async create(tenantId: string, dto: CreateMaterialDto) {
    return this.model.create({
      ...dto,
      tenantId: new Types.ObjectId(tenantId),
    });
  }

  private listFilter(tenantId: string, search?: string) {
    const base: Record<string, unknown> = { tenantId: new Types.ObjectId(tenantId) };
    if (search) {
      base.name = new RegExp(escapeRegex(search), 'i');
    }
    return base;
  }

  /** `ResourceList` (admin UI) always expects `{ items, total }` — a bare array here silently
   *  renders as an empty table even though `create`/`update` succeed, since `data.items` on a
   *  plain array is `undefined` (the exact bug reported: "adição de insumos não funciona"). */
  async findAll(tenantId: string, page: number, limit: number, search?: string) {
    const skip = skipFromPage(page, limit);
    const q = this.listFilter(tenantId, search);
    const [items, total] = await Promise.all([
      this.model.find(q).sort({ name: 1 }).skip(skip).limit(limit).exec(),
      this.model.countDocuments(q).exec(),
    ]);
    return { items, total, page, limit };
  }

  async findOne(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model
      .findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async update(tenantId: string, id: string, dto: UpdateMaterialDto) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model
      .findOneAndUpdate(
        { _id: id, tenantId: new Types.ObjectId(tenantId) },
        dto,
        { new: true },
      )
      .exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async remove(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model
      .findOneAndDelete({ _id: id, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    return { deleted: !!doc };
  }
}
