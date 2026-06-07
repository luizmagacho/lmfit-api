import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { StaffImportResponse } from '../common/dto/staff-import.response';
import { ExcelSpreadsheetService } from '../common/excel/excel-spreadsheet.service';
import { skipFromPage } from '../common/dto/pagination-query.dto';
import type { CreatePurchaseDto } from './dto/create-purchase.dto';
import type { PurchaseLineInputDto } from './dto/purchase-line-input.dto';
import type { UpdatePurchaseDto } from './dto/update-purchase.dto';
import {
  PURCHASE_EXPORT_COLUMNS,
  purchaseImportHeaderAliases,
} from './purchase-excel.constants';
import { Purchase } from './schemas/purchase.schema';

@Injectable()
export class PurchasesService {
  constructor(
    @InjectModel(Purchase.name) private readonly model: Model<Purchase>,
    private readonly excel: ExcelSpreadsheetService,
  ) {}

  async create(tenantId: string, dto: CreatePurchaseDto, createdBy?: string) {
    const lines = this.normalizePurchaseLines(dto.lines);
    return this.model.create({
      tenantId: new Types.ObjectId(tenantId),
      supplierId: new Types.ObjectId(dto.supplierId),
      status: dto.status ?? 'interest',
      reference: dto.reference,
      total: dto.total ?? 0,
      notes: dto.notes,
      lines,
      createdBy: createdBy ? new Types.ObjectId(createdBy) : undefined,
    });
  }

  private normalizePurchaseLines(
    lines?: PurchaseLineInputDto[],
  ): Purchase['lines'] {
    if (!lines?.length) return [];
    return lines.map((l) => ({
      variantId: new Types.ObjectId(l.variantId),
      quantityOrdered: l.quantityOrdered,
      quantityReceived: l.quantityReceived ?? 0,
    }));
  }

  /**
   * Quantidade ainda pendente de recebimento por variante (compras status pending).
   */
  async sumPendingOutstandingByVariantIds(
    tenantId: string,
    variantIds: Types.ObjectId[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!variantIds.length) return map;
    const rows = await this.model
      .aggregate<{ _id: Types.ObjectId; qty: number }>([
        {
          $match: {
            tenantId: new Types.ObjectId(tenantId),
            status: { $in: ['interest', 'order_reserved', 'in_transit'] },
          },
        },
        { $unwind: '$lines' },
        { $match: { 'lines.variantId': { $in: variantIds } } },
        {
          $group: {
            _id: '$lines.variantId',
            qty: {
              $sum: {
                $subtract: [
                  '$lines.quantityOrdered',
                  { $ifNull: ['$lines.quantityReceived', 0] },
                ],
              },
            },
          },
        },
      ])
      .exec();
    for (const r of rows) {
      if (r.qty > 0) map.set(String(r._id), r.qty);
    }
    return map;
  }

  private listFilter(tenantId: string, search?: string) {
    const filter: Record<string, unknown> = {
      tenantId: new Types.ObjectId(tenantId),
    };
    if (search) {
      filter.$or = [
        { reference: new RegExp(search, 'i') },
        { notes: new RegExp(search, 'i') },
      ];
    }
    return filter;
  }

  async findAll(tenantId: string, page: number, limit: number, search?: string) {
    const skip = skipFromPage(page, limit);
    const q = this.listFilter(tenantId, search);
    const [items, total] = await Promise.all([
      this.model.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.model.countDocuments(q).exec(),
    ]);
    return { items, total, page, limit };
  }

  async findAllForExport(tenantId: string, search?: string) {
    const q = this.listFilter(tenantId, search);
    return this.model.find(q).sort({ createdAt: -1 }).lean().exec();
  }

  serializeRow(doc: Record<string, unknown>): Record<string, unknown> {
    const o: Record<string, unknown> = { ...doc };
    if (o._id) o._id = String(o._id);
    if (o.supplierId) o.supplierId = String(o.supplierId);
    if (o.createdBy) o.createdBy = String(o.createdBy);
    if (Array.isArray(o.lines)) {
      o.lines = JSON.stringify(o.lines);
    }
    if (o.createdAt instanceof Date) o.createdAt = o.createdAt.toISOString();
    if (o.updatedAt instanceof Date) o.updatedAt = o.updatedAt.toISOString();
    return o;
  }

  async exportBuffer(
    tenantId: string,
    format: 'xlsx' | 'csv',
    search?: string,
  ): Promise<{ buffer: Buffer; filename: string; mime: string }> {
    const docs = await this.findAllForExport(tenantId, search);
    const rows = docs.map((d) =>
      this.serializeRow(d as unknown as Record<string, unknown>),
    );
    const buffer =
      format === 'csv'
        ? this.excel.buildCsvBuffer(PURCHASE_EXPORT_COLUMNS, rows)
        : await this.excel.buildXlsxBuffer(
            'Compras',
            PURCHASE_EXPORT_COLUMNS,
            rows,
          );
    return {
      buffer,
      filename: `purchases.${format === 'csv' ? 'csv' : 'xlsx'}`,
      mime:
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private parseLinesCell(raw: unknown): PurchaseLineInputDto[] | undefined {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return undefined;
    }
    try {
      const parsed = JSON.parse(String(raw)) as unknown;
      if (!Array.isArray(parsed)) {
        throw new BadRequestException('lines deve ser um array JSON');
      }
      return parsed as PurchaseLineInputDto[];
    } catch {
      throw new BadRequestException('lines JSON inválido');
    }
  }

  private parseRow(row: Record<string, unknown>): {
    id?: string;
    create?: CreatePurchaseDto;
    patch: UpdatePurchaseDto;
  } {
    const idRaw = row._id ?? row.id;
    const id =
      idRaw !== undefined && idRaw !== '' && String(idRaw).length === 24
        ? String(idRaw)
        : undefined;
    const total =
      row.total !== undefined && String(row.total).trim() !== ''
        ? Number(row.total)
        : undefined;
    if (total !== undefined && (Number.isNaN(total) || total < 0)) {
      throw new BadRequestException('total inválido');
    }
    const st = String(row.status ?? '').trim();
    const status =
      st && ['interest', 'order_reserved', 'in_transit', 'received', 'cancelled'].includes(st)
        ? (st as 'interest' | 'order_reserved' | 'in_transit' | 'received' | 'cancelled')
        : undefined;
    const lines = this.parseLinesCell(row.lines);
    const patch: UpdatePurchaseDto = {
      status,
      reference:
        row.reference !== undefined ? String(row.reference).trim() : undefined,
      total,
      notes: row.notes !== undefined ? String(row.notes).trim() : undefined,
      lines,
    };
    if (id) {
      return { id, patch };
    }
    const supplierId = String(row.supplierId ?? '').trim();
    if (!supplierId || !Types.ObjectId.isValid(supplierId)) {
      throw new BadRequestException('supplierId é obrigatório para novas compras');
    }
    const create: CreatePurchaseDto = {
      supplierId,
      status: patch.status,
      reference: patch.reference,
      total: patch.total ?? 0,
      notes: patch.notes,
      lines,
    };
    return { id, create, patch };
  }

  async importFromJson(
    tenantId: string,
    items: Record<string, unknown>[],
    dryRun: boolean,
    createdBy?: string,
  ): Promise<StaffImportResponse> {
    return this.importRecords(tenantId, items, dryRun, createdBy);
  }

  async importFromXlsx(
    tenantId: string,
    buffer: Buffer,
    dryRun: boolean,
    createdBy?: string,
  ): Promise<StaffImportResponse> {
    const records = await this.excel.parseFirstSheetToRecords(
      buffer,
      purchaseImportHeaderAliases(),
    );
    return this.importRecords(tenantId, records, dryRun, createdBy);
  }

  private async importRecords(
    tenantId: string,
    items: Record<string, unknown>[],
    dryRun: boolean,
    createdBy?: string,
  ): Promise<StaffImportResponse> {
    const errors: { row: number; message: string }[] = [];
    let imported = 0;
    let updated = 0;
    const skipped = 0;

    for (let i = 0; i < items.length; i++) {
      const rowNum = i + 1;
      try {
        const { id, create, patch } = this.parseRow(items[i]);
        if (dryRun) {
          if (id && Types.ObjectId.isValid(id)) {
            const exists = await this.model
              .findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) })
              .lean()
              .exec();
            if (!exists) {
              errors.push({
                row: rowNum,
                message: `_id não encontrado: ${id}`,
              });
            }
          }
          continue;
        }
        if (id && Types.ObjectId.isValid(id)) {
          const exists = await this.model.findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) }).exec();
          if (!exists) {
            errors.push({ row: rowNum, message: `_id não encontrado: ${id}` });
            continue;
          }
          await this.model.findOneAndUpdate(
            { _id: id, tenantId: new Types.ObjectId(tenantId) },
            patch,
            { new: true }
          ).exec();
          updated++;
        } else {
          if (!create) {
            errors.push({
              row: rowNum,
              message: 'Linha sem _id precisa de supplierId',
            });
            continue;
          }
          await this.create(tenantId, create, createdBy);
          imported++;
        }
      } catch (e) {
        const msg =
          e instanceof BadRequestException
            ? String(e.message)
            : e instanceof Error
              ? e.message
              : 'Erro desconhecido';
        errors.push({ row: rowNum, message: msg });
      }
    }

    if (dryRun) {
      return {
        imported: 0,
        updated: 0,
        skipped: 0,
        valid: items.length - errors.length,
        errors,
        message:
          errors.length === 0
            ? 'Validação concluída sem erros (dryRun).'
            : `Validação dryRun: ${errors.length} linha(s) com erro.`,
      };
    }

    return {
      imported,
      updated,
      skipped,
      errors,
      message:
        errors.length === 0
          ? 'Importação concluída.'
          : `Importação concluída com ${errors.length} erro(s).`,
    };
  }

  async findOne(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model.findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) }).lean().exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async update(tenantId: string, id: string, dto: UpdatePurchaseDto) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const payload: Record<string, unknown> = {};
    if (dto.status !== undefined) payload.status = dto.status;
    if (dto.reference !== undefined) payload.reference = dto.reference;
    if (dto.total !== undefined) payload.total = dto.total;
    if (dto.notes !== undefined) payload.notes = dto.notes;
    if (dto.lines !== undefined) {
      payload.lines = this.normalizePurchaseLines(dto.lines);
    }
    const doc = await this.model
      .findOneAndUpdate({ _id: id, tenantId: new Types.ObjectId(tenantId) }, payload, { new: true })
      .lean()
      .exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async remove(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const res = await this.model.findOneAndDelete({ _id: id, tenantId: new Types.ObjectId(tenantId) }).exec();
    if (!res) throw new NotFoundException();
    return { deleted: true };
  }
}
