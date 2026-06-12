import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Material, MaterialDocument } from './schemas/material.schema';
import { CreateMaterialDto } from './dto/create-material.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';

@Injectable()
export class MaterialsService {
  constructor(
    @InjectModel(Material.name) private model: Model<MaterialDocument>,
  ) {}

  async create(dto: CreateMaterialDto) {
    return this.model.create(dto);
  }

  async findAll() {
    return this.model.find().sort({ name: 1 }).exec();
  }

  async findOne(id: string) {
    return this.model.findById(id).exec();
  }

  async update(id: string, dto: UpdateMaterialDto) {
    return this.model.findByIdAndUpdate(id, dto, { new: true }).exec();
  }

  async remove(id: string) {
    const doc = await this.model.findByIdAndDelete(id).exec();
    return { deleted: !!doc };
  }
}
