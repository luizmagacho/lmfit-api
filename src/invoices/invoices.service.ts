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
import type { CreateInvoiceDto } from './dto/create-invoice.dto';
import type { InvoiceListQueryDto } from './dto/invoice-list-query.dto';
import type { UpdateInvoiceDto } from './dto/update-invoice.dto';
import {
  INVOICE_EXPORT_COLUMNS,
  invoiceImportHeaderAliases,
} from './invoice-excel.constants';
import { enrichInvoiceWithStatusI18n } from './invoice-status.i18n';
import { Invoice } from './schemas/invoice.schema';

@Injectable()
export class InvoicesService {
  constructor(
    @InjectModel(Invoice.name) private readonly model: Model<Invoice>,
    private readonly excel: ExcelSpreadsheetService,
  ) {}

  private statusFilterClause(
    status?: InvoiceListQueryDto['status'],
  ): Record<string, unknown> | undefined {
    if (!status) return undefined;
    if (status === 'pending') {
      return { status: { $in: ['pending', 'open'] } };
    }
    if (status === 'cancelled') {
      return { status: { $in: ['cancelled', 'void'] } };
    }
    return { status };
  }

  private listQuery(search?: string, status?: InvoiceListQueryDto['status']) {
    const parts: Record<string, unknown>[] = [];
    const st = this.statusFilterClause(status);
    if (st) parts.push(st);
    if (search) {
      parts.push({
        $or: [
          { number: new RegExp(search, 'i') },
          { notes: new RegExp(search, 'i') },
        ],
      });
    }
    if (parts.length === 0) return {};
    if (parts.length === 1) return parts[0];
    return { $and: parts };
  }

  async create(dto: CreateInvoiceDto, createdBy?: string) {
    const doc = await this.model.create({
      number: dto.number,
      status: dto.status ?? 'pending',
      amount: dto.amount,
      dueDate: dto.dueDate,
      orderId: dto.orderId ? new Types.ObjectId(dto.orderId) : undefined,
      purchaseId: dto.purchaseId
        ? new Types.ObjectId(dto.purchaseId)
        : undefined,
      notes: dto.notes,
      createdBy: createdBy ? new Types.ObjectId(createdBy) : undefined,
    });
    return enrichInvoiceWithStatusI18n(doc.toObject() as { status?: string });
  }

  async findAll(
    page: number,
    limit: number,
    search?: string,
    status?: InvoiceListQueryDto['status'],
  ) {
    const skip = skipFromPage(page, limit);
    const q = this.listQuery(search, status);
    const [rawItems, total] = await Promise.all([
      this.model.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.model.countDocuments(q).exec(),
    ]);
    const items = rawItems.map((row) =>
      enrichInvoiceWithStatusI18n(row as { status?: string }),
    );
    return { items, total, page, limit };
  }

  async findAllForExport(
    search?: string,
    status?: InvoiceListQueryDto['status'],
  ) {
    const q = this.listQuery(search, status);
    return this.model.find(q).sort({ createdAt: -1 }).lean().exec();
  }

  serializeInvoiceRow(doc: Record<string, unknown>): Record<string, unknown> {
    const o: Record<string, unknown> = { ...doc };
    for (const k of ['_id', 'orderId', 'purchaseId', 'createdBy']) {
      if (o[k]) o[k] = String(o[k]);
    }
    if (o.dueDate instanceof Date) o.dueDate = o.dueDate.toISOString();
    if (o.createdAt instanceof Date) o.createdAt = o.createdAt.toISOString();
    if (o.updatedAt instanceof Date) o.updatedAt = o.updatedAt.toISOString();
    return o;
  }

  async exportBuffer(
    format: 'xlsx' | 'csv',
    search?: string,
    status?: InvoiceListQueryDto['status'],
  ): Promise<{ buffer: Buffer; filename: string; mime: string }> {
    const docs = await this.findAllForExport(search, status);
    const rows = docs.map((d) =>
      this.serializeInvoiceRow(d as unknown as Record<string, unknown>),
    );
    const buffer =
      format === 'csv'
        ? this.excel.buildCsvBuffer(INVOICE_EXPORT_COLUMNS, rows)
        : await this.excel.buildXlsxBuffer(
            'Faturas',
            INVOICE_EXPORT_COLUMNS,
            rows,
          );
    return {
      buffer,
      filename: `invoices.${format === 'csv' ? 'csv' : 'xlsx'}`,
      mime:
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private parseInvoiceRow(row: Record<string, unknown>): {
    id?: string;
    create: CreateInvoiceDto;
    patch: UpdateInvoiceDto;
  } {
    const idRaw = row._id ?? row.id;
    const id =
      idRaw !== undefined && idRaw !== '' && String(idRaw).length === 24
        ? String(idRaw)
        : undefined;
    const amount = Number(row.amount ?? 0);
    if (Number.isNaN(amount) || amount < 0) {
      throw new BadRequestException('amount inválido');
    }
    let dueDate: Date | undefined;
    if (row.dueDate !== undefined && row.dueDate !== '') {
      const d = new Date(String(row.dueDate));
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException('dueDate inválido');
      }
      dueDate = d;
    }
    const statusRaw = row.status !== undefined ? String(row.status).trim() : '';
    const allowed = ['pending', 'paid', 'overdue', 'cancelled'] as const;
    const status = allowed.includes(statusRaw as (typeof allowed)[number])
      ? (statusRaw as (typeof allowed)[number])
      : undefined;

    const create: CreateInvoiceDto = {
      number:
        row.number !== undefined ? String(row.number).trim() : undefined,
      status,
      amount,
      dueDate,
      orderId:
        row.orderId !== undefined && String(row.orderId).trim()
          ? String(row.orderId)
          : undefined,
      purchaseId:
        row.purchaseId !== undefined && String(row.purchaseId).trim()
          ? String(row.purchaseId)
          : undefined,
      notes: row.notes !== undefined ? String(row.notes).trim() : undefined,
    };

    const patch: UpdateInvoiceDto = {
      number: create.number,
      status,
      amount,
      dueDate,
      notes: create.notes,
    };
    return { id, create, patch };
  }

  async importFromJson(
    items: Record<string, unknown>[],
    dryRun: boolean,
    createdBy?: string,
  ): Promise<StaffImportResponse> {
    return this.importRecords(items, dryRun, createdBy);
  }

  async importFromXlsx(
    buffer: Buffer,
    dryRun: boolean,
    createdBy?: string,
  ): Promise<StaffImportResponse> {
    const records = await this.excel.parseFirstSheetToRecords(
      buffer,
      invoiceImportHeaderAliases(),
    );
    return this.importRecords(records, dryRun, createdBy);
  }

  private async importRecords(
    items: Record<string, unknown>[],
    dryRun: boolean,
    createdBy?: string,
  ): Promise<StaffImportResponse> {
    const errors: { row: number; message: string }[] = [];
    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < items.length; i++) {
      const rowNum = i + 1;
      try {
        const { id, create, patch } = this.parseInvoiceRow(items[i]);
        if (dryRun) {
          if (id && Types.ObjectId.isValid(id)) {
            const exists = await this.model.findById(id).lean().exec();
            if (!exists) {
              errors.push({
                row: rowNum,
                message: `_id não encontrado: ${id}`,
              });
            }
          }
          void create;
          void patch;
          continue;
        }
        if (id && Types.ObjectId.isValid(id)) {
          const exists = await this.model.findById(id).exec();
          if (!exists) {
            errors.push({ row: rowNum, message: `_id não encontrado: ${id}` });
            continue;
          }
          await this.model.findByIdAndUpdate(id, patch, { new: true }).exec();
          updated++;
        } else {
          await this.create(create, createdBy);
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
      const valid = items.length - errors.length;
      return {
        imported: 0,
        updated: 0,
        skipped: 0,
        valid,
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

  async findOne(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model.findById(id).lean().exec();
    if (!doc) throw new NotFoundException();
    return enrichInvoiceWithStatusI18n(doc as { status?: string });
  }

  async update(id: string, dto: UpdateInvoiceDto) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model
      .findByIdAndUpdate(id, dto, { new: true })
      .lean()
      .exec();
    if (!doc) throw new NotFoundException();
    return enrichInvoiceWithStatusI18n(doc as { status?: string });
  }

  async remove(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const res = await this.model.findByIdAndDelete(id).exec();
    if (!res) throw new NotFoundException();
    return { deleted: true };
  }
}
