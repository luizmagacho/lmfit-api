import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductionBatch } from './schemas/production-batch.schema';
import type { CreateProductionBatchDto } from './dto/create-production-batch.dto';
import type { UpdateProductionBatchDto } from './dto/update-production-batch.dto';
import { skipFromPage } from '../common/dto/pagination-query.dto';

@Injectable()
export class ProductionService {
  constructor(
    @InjectModel(ProductionBatch.name)
    private readonly model: Model<ProductionBatch>,
  ) {}

  /**
   * Calcula os custos derivados do lote:
   *   totalInputsCost = Σ(input.totalCost)
   *   totalBatchCost  = totalInputsCost + cuttingCost + sewingCost + overhead
   *   costPerUnit     = totalBatchCost / batchQty
   *   suggestedPrice  = costPerUnit / (1 - targetMarginPercent/100)
   */
  private computeCosts(dto: Partial<CreateProductionBatchDto>): {
    totalInputsCost: number;
    totalBatchCost: number;
    costPerUnit: number;
    suggestedPrice: number;
  } {
    const batchQty = dto.batchQty ?? 1;
    const totalInputsCost = (dto.inputs ?? []).reduce(
      (sum, i) => sum + (i.totalCost ?? i.quantity * i.unitPrice),
      0,
    );
    const cuttingCost = dto.cuttingCost ?? 0;
    const sewingCost = dto.sewingCost ?? 0;
    const overheadPercent = dto.overheadPercent ?? 0;
    const laborAndMaterial = totalInputsCost + cuttingCost + sewingCost;
    const overhead = (laborAndMaterial * overheadPercent) / 100;
    const totalBatchCost = laborAndMaterial + overhead;
    const costPerUnit = batchQty > 0 ? totalBatchCost / batchQty : 0;
    const targetMargin = dto.targetMarginPercent ?? 60;
    const suggestedPrice =
      targetMargin < 100 ? costPerUnit / (1 - targetMargin / 100) : 0;

    return {
      totalInputsCost: Math.round(totalInputsCost * 100) / 100,
      totalBatchCost: Math.round(totalBatchCost * 100) / 100,
      costPerUnit: Math.round(costPerUnit * 100) / 100,
      suggestedPrice: Math.round(suggestedPrice * 100) / 100,
    };
  }

  async create(tenantId: string, dto: CreateProductionBatchDto) {
    const computed = this.computeCosts(dto);
    return this.model.create({
      tenantId: new Types.ObjectId(tenantId),
      name: dto.name,
      sku: dto.sku,
      batchQty: dto.batchQty,
      status: dto.status ?? 'Planejado',
      inputs: (dto.inputs ?? []).map((i) => ({
        ...i,
        totalCost: i.totalCost ?? i.quantity * i.unitPrice,
      })),
      cuttingCost: dto.cuttingCost ?? 0,
      sewingCost: dto.sewingCost ?? 0,
      overheadPercent: dto.overheadPercent ?? 0,
      targetMarginPercent: dto.targetMarginPercent ?? 60,
      notes: dto.notes,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      ...computed,
    });
  }

  async findAll(tenantId: string, page: number, limit: number, search?: string, status?: string) {
    const skip = skipFromPage(page, limit);
    const q: Record<string, unknown> = {
      tenantId: new Types.ObjectId(tenantId),
    };
    if (status) q.status = status;
    if (search) {
      q.$or = [
        { name: new RegExp(search, 'i') },
        { sku: new RegExp(search, 'i') },
        { notes: new RegExp(search, 'i') },
      ];
    }
    const [items, total] = await Promise.all([
      this.model.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.model.countDocuments(q).exec(),
    ]);
    return { items, total, page, limit };
  }

  /** Retorna todos os lotes agrupados por status (para o Kanban) */
  async findKanban(tenantId: string) {
    const all = await this.model
      .find({ tenantId: new Types.ObjectId(tenantId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    const grouped: Record<string, typeof all> = {};
    for (const batch of all) {
      const s = batch.status ?? 'Planejado';
      if (!grouped[s]) grouped[s] = [];
      grouped[s].push(batch);
    }
    return grouped;
  }

  /** Lista todos os status distintos existentes */
  async getDistinctStatuses(tenantId: string): Promise<string[]> {
    const statuses = await this.model
      .distinct('status', { tenantId: new Types.ObjectId(tenantId) })
      .exec() as string[];
    return statuses.sort();
  }

  async findOne(tenantId: string, id: string) {
    const doc = await this.model
      .findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) })
      .lean()
      .exec();
    if (!doc) throw new NotFoundException('Lote de produção não encontrado');
    return doc;
  }

  async update(tenantId: string, id: string, dto: UpdateProductionBatchDto) {
    const existing = await this.model
      .findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) })
      .lean()
      .exec();
    if (!existing) throw new NotFoundException('Lote de produção não encontrado');

    // Merge para recalcular custos com dados atualizados
    const merged: Partial<CreateProductionBatchDto> = {
      batchQty: dto.batchQty ?? existing.batchQty,
      inputs: dto.inputs ?? (existing.inputs as CreateProductionBatchDto['inputs']),
      cuttingCost: dto.cuttingCost ?? existing.cuttingCost,
      sewingCost: dto.sewingCost ?? existing.sewingCost,
      overheadPercent: dto.overheadPercent ?? existing.overheadPercent,
      targetMarginPercent: dto.targetMarginPercent ?? existing.targetMarginPercent,
    };

    const computed = this.computeCosts(merged);

    const payload: Record<string, unknown> = { ...computed };
    if (dto.name !== undefined) payload.name = dto.name;
    if (dto.sku !== undefined) payload.sku = dto.sku;
    if (dto.batchQty !== undefined) payload.batchQty = dto.batchQty;
    if (dto.status !== undefined) payload.status = dto.status;
    if (dto.inputs !== undefined)
      payload.inputs = dto.inputs.map((i) => ({
        ...i,
        totalCost: i.totalCost ?? i.quantity * i.unitPrice,
      }));
    if (dto.cuttingCost !== undefined) payload.cuttingCost = dto.cuttingCost;
    if (dto.sewingCost !== undefined) payload.sewingCost = dto.sewingCost;
    if (dto.overheadPercent !== undefined) payload.overheadPercent = dto.overheadPercent;
    if (dto.targetMarginPercent !== undefined) payload.targetMarginPercent = dto.targetMarginPercent;
    if (dto.notes !== undefined) payload.notes = dto.notes;
    if (dto.dueDate !== undefined) payload.dueDate = new Date(dto.dueDate);

    const doc = await this.model
      .findOneAndUpdate(
        { _id: id, tenantId: new Types.ObjectId(tenantId) },
        payload,
        { new: true }
      )
      .lean()
      .exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async remove(tenantId: string, id: string) {
    const res = await this.model
      .findOneAndDelete({ _id: id, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!res) throw new NotFoundException();
    return { deleted: true };
  }

  /**
   * Retorna o custo médio por peça ponderado de todos os lotes no período,
   * e o CMV total estimado (usado pelo DRE).
   */
  async getCmvSummary(tenantId: string, from: Date, to: Date) {
    const rows = await this.model
      .aggregate<{
        totalBatchCost: number;
        totalUnits: number;
        batchCount: number;
      }>([
        {
          $match: {
            tenantId: new Types.ObjectId(tenantId),
            createdAt: { $gte: from, $lte: to },
          },
        },
        {
          $group: {
            _id: null,
            totalBatchCost: { $sum: '$totalBatchCost' },
            totalUnits: { $sum: '$batchQty' },
            batchCount: { $sum: 1 },
          },
        },
      ])
      .exec();

    const row = rows[0];
    if (!row) return { totalBatchCost: 0, totalUnits: 0, avgCostPerUnit: 0, batchCount: 0 };
    return {
      totalBatchCost: row.totalBatchCost,
      totalUnits: row.totalUnits,
      avgCostPerUnit:
        row.totalUnits > 0
          ? Math.round((row.totalBatchCost / row.totalUnits) * 100) / 100
          : 0,
      batchCount: row.batchCount,
    };
  }
}
