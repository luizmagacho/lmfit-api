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
import { ProductVariant } from '../products/schemas/product-variant.schema';
import { Material } from '../materials/schemas/material.schema';
import { LocationsService } from '../locations/locations.service';
import { ProductsService } from '../products/products.service';
import { escapeRegex } from '../common/utils/text-search.util';

@Injectable()
export class PurchasesService {
  constructor(
    @InjectModel(Purchase.name) private readonly model: Model<Purchase>,
    @InjectModel(ProductVariant.name) private readonly variantModel: Model<ProductVariant>,
    @InjectModel(Material.name) private readonly materialModel: Model<Material>,
    private readonly excel: ExcelSpreadsheetService,
    private readonly locations: LocationsService,
    private readonly products: ProductsService,
  ) {}

  /**
   * A linha pode trazer `newVariant` em vez de `variantId` quando o fornecedor está
   * entregando uma cor/tamanho que a loja ainda não tinha cadastrado — cria a
   * ProductVariant agora e resolve a linha para o `variantId` resultante, pra que o
   * fluxo normal de recebimento (adjustStock) credite o estoque dela como qualquer outra.
   */
  private async resolveNewVariants(
    tenantId: string,
    lines: PurchaseLineInputDto[],
  ): Promise<PurchaseLineInputDto[]> {
    const resolved: PurchaseLineInputDto[] = [];
    // Several lines in the same purchase can share `newProductName` (e.g. "Conjunto Novo"
    // in Preto/G, Preto/GG, Preto/P) — create that product once and reuse it across all
    // of them instead of creating a duplicate product per line.
    const productIdByName = new Map<string, string>();
    for (const l of lines) {
      if (!l.variantId && l.newVariant) {
        let productId = l.newVariant.productId;
        if (!productId && l.newVariant.newProductName) {
          const key = l.newVariant.newProductName.trim().toLowerCase();
          if (!productIdByName.has(key)) {
            const product = await this.products.findOrCreateProductByName(tenantId, l.newVariant.newProductName);
            productIdByName.set(key, String(product._id));
          }
          productId = productIdByName.get(key);
        }
        if (!productId) {
          throw new BadRequestException('newVariant precisa de productId ou newProductName');
        }
        const variant = await this.products.createVariant(tenantId, productId, {
          sku: l.newVariant.sku,
          color: l.newVariant.color,
          size: l.newVariant.size,
          price: l.newVariant.price,
        });
        resolved.push({ ...l, variantId: String(variant._id), newVariant: undefined });
      } else {
        resolved.push(l);
      }
    }
    return resolved;
  }

  async create(tenantId: string, dto: CreatePurchaseDto, createdBy?: string) {
    const resolvedLines = await this.resolveNewVariants(tenantId, dto.lines ?? []);
    const lines = this.normalizePurchaseLines(resolvedLines);
    const doc = await this.model.create({
      tenantId: new Types.ObjectId(tenantId),
      supplierId: new Types.ObjectId(dto.supplierId),
      status: dto.status ?? 'pending',
      reference: dto.reference,
      total: dto.total ?? 0,
      notes: dto.notes,
      lines,
      createdBy: createdBy ? new Types.ObjectId(createdBy) : undefined,
    });
    if (doc.status === 'completed') {
      await this.adjustStock(doc, 1);
    }
    return doc;
  }

  private normalizePurchaseLines(
    lines?: PurchaseLineInputDto[],
  ): Purchase['lines'] {
    if (!lines?.length) return [];
    return lines.map((l) => ({
      variantId: l.variantId ? new Types.ObjectId(l.variantId) : undefined,
      materialId: l.materialId ? new Types.ObjectId(l.materialId) : undefined,
      rawName: l.rawName,
      unitPrice: l.unitPrice ?? 0,
      quantityOrdered: l.quantityOrdered,
      quantityReceived: l.quantityReceived ?? 0,
    }));
  }

  /**
   * Quantidade ainda pendente de recebimento por variante (compras status pending).
   */
  async sumPendingOutstandingByVariantIds(
    variantIds: Types.ObjectId[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!variantIds.length) return map;
    const rows = await this.model
      .aggregate<{ _id: Types.ObjectId; qty: number }>([
        { $match: { status: { $in: ['pending', 'started'] } } },
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
    return {
      tenantId: new Types.ObjectId(tenantId),
      // Escape user input before building the regex — same ReDoS class already fixed for
      // products/customers/orders search.
      ...(search
        ? {
            $or: [
              { reference: new RegExp(escapeRegex(search), 'i') },
              { notes: new RegExp(escapeRegex(search), 'i') },
            ],
          }
        : {}),
    };
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
      st && ['pending', 'started', 'completed', 'cancelled'].includes(st)
        ? (st as 'pending' | 'started' | 'completed' | 'cancelled')
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
        const scoped = { _id: id, tenantId: new Types.ObjectId(tenantId) };
        if (dryRun) {
          if (id && Types.ObjectId.isValid(id)) {
            const exists = await this.model.findOne(scoped).lean().exec();
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
          const exists = await this.model.findOne(scoped).exec();
          if (!exists) {
            errors.push({ row: rowNum, message: `_id não encontrado: ${id}` });
            continue;
          }
          await this.model.findOneAndUpdate(scoped, patch, { new: true }).exec();
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
    const doc = await this.model
      .findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) })
      .populate<{ supplierId: { _id: Types.ObjectId; name: string } | null }>('supplierId', 'name')
      .lean()
      .exec();
    if (!doc) throw new NotFoundException();
    const o = doc as unknown as Record<string, unknown>;
    if (o.supplierId && typeof o.supplierId === 'object') {
      const sup = o.supplierId as { _id: Types.ObjectId; name: string };
      o.supplierName = sup.name;
      o.supplierId = String(sup._id);
    }
    return o;
  }

  
  private async adjustStock(doc: Purchase, multiplier: number) {
    if (!doc.lines?.length) return;
    for (const line of doc.lines) {
      const qty = (line.quantityReceived || 0) * multiplier;
      if (qty === 0) continue;
      if (line.variantId) {
        await this.variantModel.updateOne(
          { _id: line.variantId },
          { $inc: { quantityOnHand: qty } }
        ).exec();
        await this.locations.adjust(String(doc.tenantId), line.variantId, qty);
      } else if (line.materialId) {
        await this.materialModel.updateOne(
          { _id: line.materialId },
          { $inc: { quantityOnHand: qty } }
        ).exec();
      }
    }
  }
  async update(tenantId: string, id: string, dto: UpdatePurchaseDto) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const scoped = { _id: id, tenantId: new Types.ObjectId(tenantId) };
    const payload: Record<string, unknown> = {};
    if (dto.status !== undefined) payload.status = dto.status;
    if (dto.reference !== undefined) payload.reference = dto.reference;
    if (dto.total !== undefined) payload.total = dto.total;
    if (dto.notes !== undefined) payload.notes = dto.notes;
    if (dto.lines !== undefined) {
      const resolvedLines = await this.resolveNewVariants(tenantId, dto.lines);
      payload.lines = this.normalizePurchaseLines(resolvedLines);
    }
    const oldDoc = await this.model.findOne(scoped).lean().exec();
    if (!oldDoc) throw new NotFoundException();
    if (oldDoc.status === 'completed') {
      await this.adjustStock(oldDoc as any, -1);
    }

    const doc = await this.model.findOneAndUpdate(scoped, payload, { new: true }).lean().exec();
    if (!doc) throw new NotFoundException();

    if (doc.status === 'completed') {
      await this.adjustStock(doc as any, 1);
    }
    return doc;
  }

  async remove(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const scoped = { _id: id, tenantId: new Types.ObjectId(tenantId) };
    const oldDoc = await this.model.findOne(scoped).lean().exec();
    if (oldDoc && oldDoc.status === 'completed') {
      await this.adjustStock(oldDoc as any, -1);
    }
    const res = await this.model.findOneAndDelete(scoped).exec();
    if (!res) throw new NotFoundException();
    return { deleted: true };
  }
}
