import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { skipFromPage } from '../common/dto/pagination-query.dto';
import {
  CashflowEntry,
} from './schemas/cashflow-entry.schema';
import type { CreateCashflowImportDto } from './dto/create-cashflow-import.dto';
import type { CreateCashflowEntryDto } from './dto/create-cashflow-entry.dto';
import type { UpdateCashflowEntryDto } from './dto/update-cashflow-entry.dto';
import { GeminiService } from '../gemini/gemini.service';

@Injectable()
export class CashflowService {
  private readonly log = new Logger(CashflowService.name);

  constructor(
    @InjectModel(CashflowEntry.name)
    private readonly model: Model<CashflowEntry>,
    private readonly gemini: GeminiService,
  ) {}

  async importBatch(
    dto: CreateCashflowImportDto,
    createdById?: string,
  ) {
    const batchId = randomUUID();
    const createdBy = createdById
      ? new Types.ObjectId(createdById)
      : undefined;

    const docs = dto.transactions.map((tx) => ({
      date: new Date(tx.date),
      hour: tx.hour,
      type: tx.type,
      name: tx.name,
      detail: tx.detail,
      amount: tx.amount,
      source: dto.source ?? 'infinitepay',
      importBatch: batchId,
      periodFrom: dto.periodFrom ? new Date(dto.periodFrom) : undefined,
      periodTo: dto.periodTo ? new Date(dto.periodTo) : undefined,
      createdBy,
    }));

    const inserted = await this.model.insertMany(docs);

    // Optionally trigger AI analysis in background (non-blocking)
    if (dto.analyzeWithAi) {
      void this.analyzeEntireBatch(
        batchId,
        inserted.map((d) => String(d._id)),
      ).catch((e: unknown) => {
        this.log.error('AI batch analysis error', e);
      });
    }

    return { importBatch: batchId, count: inserted.length };
  }

  async createEntry(dto: CreateCashflowEntryDto, createdById?: string) {
    const doc = await this.model.create({
      date: new Date(dto.date),
      hour: dto.hour,
      type: dto.type,
      name: dto.name,
      detail: dto.detail,
      amount: dto.amount,
      source: 'manual',
      importBatch: 'manual',
      customerId: dto.customerId ? new Types.ObjectId(dto.customerId) : undefined,
      supplierId: dto.supplierId ? new Types.ObjectId(dto.supplierId) : undefined,
      createdBy: createdById ? new Types.ObjectId(createdById) : undefined,
    });
    return doc;
  }

  async updateEntry(id: string, dto: UpdateCashflowEntryDto) {
    const patch: Record<string, unknown> = {};
    if (dto.date) patch.date = new Date(dto.date);
    if (dto.hour !== undefined) patch.hour = dto.hour;
    if (dto.type) patch.type = dto.type;
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.detail !== undefined) patch.detail = dto.detail;
    if (dto.amount !== undefined) patch.amount = dto.amount;
    if (dto.customerId !== undefined) patch.customerId = dto.customerId ? new Types.ObjectId(dto.customerId) : null;
    if (dto.supplierId !== undefined) patch.supplierId = dto.supplierId ? new Types.ObjectId(dto.supplierId) : null;

    const doc = await this.model.findByIdAndUpdate(id, patch, { new: true }).exec();
    return doc;
  }

  async removeEntry(id: string) {
    const doc = await this.model.findByIdAndDelete(id).exec();
    return { deleted: !!doc };
  }

  async findAll(opts: {
    page: number;
    limit: number;
    from?: string;
    to?: string;
    type?: string;
    importBatch?: string;
  }) {
    const skip = skipFromPage(opts.page, opts.limit);
    const filter: Record<string, unknown> = {};

    if (opts.from || opts.to) {
      filter['date'] = {
        ...(opts.from ? { $gte: new Date(opts.from) } : {}),
        ...(opts.to ? { $lte: new Date(opts.to) } : {}),
      };
    }
    if (opts.type) filter['type'] = opts.type;
    if (opts.importBatch) filter['importBatch'] = opts.importBatch;

    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ date: -1, hour: -1 })
        .skip(skip)
        .limit(opts.limit)
        .lean(),
      this.model.countDocuments(filter),
    ]);

    return { items, total, page: opts.page, limit: opts.limit };
  }

  async summary(from?: string, to?: string) {
    const matchDate: Record<string, unknown> = {};
    if (from || to) {
      matchDate['date'] = {
        ...(from ? { $gte: new Date(from) } : {}),
        ...(to ? { $lte: new Date(to) } : {}),
      };
    }

    const [agg] = await this.model.aggregate([
      { $match: matchDate },
      {
        $group: {
          _id: null,
          totalIn: { $sum: { $cond: [{ $gt: ['$amount', 0] }, '$amount', 0] } },
          totalOut: { $sum: { $cond: [{ $lt: ['$amount', 0] }, '$amount', 0] } },
          salesIn: {
            $sum: {
              $cond: [
                { $eq: ['$type', 'deposit_sales'] },
                '$amount',
                0,
              ],
            },
          },
          pixIn: {
            $sum: {
              $cond: [{ $eq: ['$type', 'pix_received'] }, '$amount', 0],
            },
          },
          pixOut: {
            $sum: {
              $cond: [{ $eq: ['$type', 'pix_sent'] }, '$amount', 0],
            },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const dailyAgg = await this.model.aggregate([
      { $match: matchDate },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          totalIn: { $sum: { $cond: [{ $gt: ['$amount', 0] }, '$amount', 0] } },
          totalOut: {
            $sum: { $cond: [{ $lt: ['$amount', 0] }, '$amount', 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return {
      totalIn: agg?.totalIn ?? 0,
      totalOut: agg?.totalOut ?? 0,
      balance: (agg?.totalIn ?? 0) + (agg?.totalOut ?? 0),
      salesIn: agg?.salesIn ?? 0,
      pixIn: agg?.pixIn ?? 0,
      pixOut: agg?.pixOut ?? 0,
      count: agg?.count ?? 0,
      daily: dailyAgg.map((d) => ({
        date: d._id as string,
        in: d.totalIn as number,
        out: Math.abs(d.totalOut as number),
      })),
    };
  }

  async listBatches() {
    return this.model.aggregate([
      {
        $group: {
          _id: '$importBatch',
          count: { $sum: 1 },
          totalIn: {
            $sum: { $cond: [{ $gt: ['$amount', 0] }, '$amount', 0] },
          },
          totalOut: {
            $sum: { $cond: [{ $lt: ['$amount', 0] }, '$amount', 0] },
          },
          periodFrom: { $min: '$periodFrom' },
          periodTo: { $max: '$periodTo' },
          importedAt: { $min: '$createdAt' },
          source: { $first: '$source' },
        },
      },
      { $sort: { importedAt: -1 } },
    ]);
  }

  async removeBatch(batchId: string) {
    const res = await this.model.deleteMany({ importBatch: batchId });
    return { deleted: res.deletedCount };
  }

  async analyzeEntry(id: string) {
    const entry = await this.model.findById(id).lean();
    if (!entry) return null;

    const text = `Transação financeira de uma loja de moda fitness brasileira:
Tipo: ${entry.type}
Nome: ${entry.name ?? ''}
Detalhe: ${entry.detail ?? ''}
Valor: R$ ${Math.abs(entry.amount).toFixed(2)} (${entry.amount >= 0 ? 'entrada' : 'saída'})
Data: ${entry.date.toLocaleDateString('pt-BR')}`;

    const analysis = await this.gemini.analyzeTransaction(text);
    await this.model.findByIdAndUpdate(id, { aiAnalysis: analysis });
    return analysis;
  }

  async analyzeEntireBatch(batchId: string, ids: string[]) {
    const CONCURRENCY = 3;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      chunks.push(ids.slice(i, i + CONCURRENCY));
    }
    for (const chunk of chunks) {
      await Promise.all(chunk.map((id) => this.analyzeEntry(id).catch(() => null)));
    }
    this.log.log(`Batch ${batchId}: AI analysis complete (${ids.length} entries)`);
  }
}
