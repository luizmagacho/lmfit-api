import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductionBatch } from './schemas/production-batch.schema';
import type { CreateProductionBatchDto } from './dto/create-production-batch.dto';
import type { UpdateProductionBatchDto } from './dto/update-production-batch.dto';
import { skipFromPage } from '../common/dto/pagination-query.dto';
import { ProductVariant } from '../products/schemas/product-variant.schema';

@Injectable()
export class ProductionService {
  constructor(
    @InjectModel(ProductionBatch.name)
    private readonly model: Model<ProductionBatch>,
    @InjectModel(ProductVariant.name)
    private readonly variantModel: Model<ProductVariant>,
  ) {}

  /**
   * Calcula os custos derivados do lote:
   *   totalInputsCost = Σ(input.totalCost)
   *   totalBatchCost  = totalInputsCost + cuttingCost + sewingCost + overhead
   *   costPerUnit     = totalBatchCost / batchQty
   *   suggestedPrice  = costPerUnit / (1 - targetMarginPercent/100)
   */
  
  private async adjustStock(doc: ProductionBatch, multiplier: number) {
    if (!doc.sku || !doc.batchQty) return;
    const qty = doc.batchQty * multiplier;
    if (qty === 0) return;
    await this.variantModel.updateOne(
      { sku: doc.sku },
      { $inc: { quantityOnHand: qty } }
    ).exec();
  }

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
    let finalDto = { ...dto };

    // Auto-copy inputs and costs from a previous batch if none provided
    if ((!finalDto.inputs || finalDto.inputs.length === 0) && finalDto.sku) {
      const lastBatch = await this.model
        .findOne({ tenantId, sku: finalDto.sku })
        .sort({ createdAt: -1 })
        .lean();

      if (lastBatch && lastBatch.batchQty > 0) {
        const ratio = (finalDto.batchQty ?? 1) / lastBatch.batchQty;
        finalDto.inputs = (lastBatch.inputs || []).map((i) => ({
          description: i.description,
          inputType: i.inputType,
          unit: i.unit,
          unitPrice: i.unitPrice,
          quantity: Number((i.quantity * ratio).toFixed(3)),
          totalCost: Number((i.quantity * ratio * i.unitPrice).toFixed(2)),
        }));
        finalDto.cuttingCost = Number(((lastBatch.cuttingCost || 0) * ratio).toFixed(2));
        finalDto.sewingCost = Number(((lastBatch.sewingCost || 0) * ratio).toFixed(2));
        finalDto.overheadPercent = lastBatch.overheadPercent || 0;
        finalDto.targetMarginPercent = lastBatch.targetMarginPercent || 60;
      }
    }

    const computed = this.computeCosts(finalDto);
    const doc = await this.model.create({
      tenantId,
      name: finalDto.name,
      sku: finalDto.sku,
      batchQty: finalDto.batchQty,
      status: finalDto.status ?? 'Planejado',
      inputs: (finalDto.inputs ?? []).map((i) => ({
        ...i,
        totalCost: i.totalCost ?? i.quantity * i.unitPrice,
      })),
      cuttingCost: finalDto.cuttingCost ?? 0,
      sewingCost: finalDto.sewingCost ?? 0,
      overheadPercent: finalDto.overheadPercent ?? 0,
      targetMarginPercent: finalDto.targetMarginPercent ?? 60,
      notes: finalDto.notes,
      imageUrl: finalDto.imageUrl,
      dueDate: finalDto.dueDate ? new Date(finalDto.dueDate) : undefined,
      ...computed,
    });
    if (doc.status === 'Concluído' || doc.status === 'Pronto') {
      await this.adjustStock(doc as any, 1);
    }
    return doc;
  }

  async findAll(tenantId: string, page: number, limit: number, search?: string, status?: string) {
    const skip = skipFromPage(page, limit);
    const q: Record<string, unknown> = { tenantId };
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
    const all = await this.model.find({ tenantId }).sort({ createdAt: -1 }).lean().exec();
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
    const statuses = await this.model.distinct('status', { tenantId }).exec() as string[];
    return statuses.sort();
  }

  async findOne(tenantId: string, id: string) {
    const doc = await this.model.findOne({ _id: id, tenantId }).lean().exec();
    if (!doc) throw new NotFoundException('Lote de produção não encontrado');
    return doc;
  }

  async update(tenantId: string, id: string, dto: UpdateProductionBatchDto) {
    const existing = await this.model.findOne({ _id: id, tenantId }).lean().exec();
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
    if (dto.imageUrl !== undefined) payload.imageUrl = dto.imageUrl;
    if (dto.dueDate !== undefined) payload.dueDate = new Date(dto.dueDate);

    if (existing.status === 'Concluído' || existing.status === 'Pronto') {
      await this.adjustStock(existing as any, -1);
    }

    const doc = await this.model
      .findOneAndUpdate({ _id: id, tenantId }, { $set: payload }, { new: true })
      .lean()
      .exec();
    if (!doc) throw new NotFoundException();

    if (doc.status === 'Concluído' || doc.status === 'Pronto') {
      await this.adjustStock(doc as any, 1);
    }
    return doc;
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.model.findOne({ _id: id, tenantId }).lean().exec();
    if (!existing) throw new NotFoundException('Lote de produção não encontrado');

    if (existing.status === 'Concluído' || existing.status === 'Pronto') {
      await this.adjustStock(existing as any, -1);
    }
    const res = await this.model.deleteOne({ _id: id, tenantId }).exec();
    if (!res.deletedCount) throw new NotFoundException();
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
        { $match: { createdAt: { $gte: from, $lte: to } } },
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
