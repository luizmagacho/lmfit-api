import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { StaffImportResponse } from '../common/dto/staff-import.response';
import { ExcelSpreadsheetService } from '../common/excel/excel-spreadsheet.service';
import { parseBooleanLoose } from '../common/excel/cell-coerce';
import { skipFromPage } from '../common/dto/pagination-query.dto';
import {
  CUSTOMER_EXPORT_COLUMNS,
  customerImportHeaderAliases,
} from './customer-excel.constants';
import type { CreateCustomerDto } from './dto/create-customer.dto';
import type { UpdateCustomerDto } from './dto/update-customer.dto';
import { Customer, type CustomerDocument } from './schemas/customer.schema';

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(Customer.name) private readonly model: Model<Customer>,
    private readonly excel: ExcelSpreadsheetService,
  ) {}

  async create(tenantId: string, dto: CreateCustomerDto, createdBy?: string) {
    return this.model.create({
      ...dto,
      tenantId: new Types.ObjectId(tenantId),
      createdBy: createdBy ? new Types.ObjectId(createdBy) : undefined,
    });
  }

  private listFilter(tenantId: string, search?: string) {
    const base: Record<string, any> = { tenantId: new Types.ObjectId(tenantId) };
    if (search) {
      base.$or = [
        { name: new RegExp(search, 'i') },
        { email: new RegExp(search, 'i') },
      ];
    }
    return base;
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

  serializeCustomerRow(doc: Record<string, unknown>): Record<string, unknown> {
    const o: Record<string, unknown> = { ...doc };
    if (o._id) o._id = String(o._id);
    if (o.createdBy) o.createdBy = String(o.createdBy);
    if (Array.isArray(o.addresses)) {
      o.addresses = JSON.stringify(o.addresses);
    }
    if (typeof o.marketingOptIn === 'boolean') {
      o.marketingOptIn = o.marketingOptIn ? 'Sim' : 'Não';
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
      this.serializeCustomerRow(d as unknown as Record<string, unknown>),
    );
    const buffer =
      format === 'csv'
        ? this.excel.buildCsvBuffer(CUSTOMER_EXPORT_COLUMNS, rows)
        : await this.excel.buildXlsxBuffer(
            'Clientes',
            CUSTOMER_EXPORT_COLUMNS,
            rows,
          );
    return {
      buffer,
      filename: `customers.${format === 'csv' ? 'csv' : 'xlsx'}`,
      mime:
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private parseCustomerRow(
    row: Record<string, unknown>,
  ): { id?: string; create: CreateCustomerDto; patch: UpdateCustomerDto } {
    const idRaw = row._id ?? row.id;
    const id =
      idRaw !== undefined && idRaw !== '' && String(idRaw).length === 24
        ? String(idRaw)
        : undefined;
    const marketingRaw = row.marketingOptIn;
    const marketingOptIn =
      marketingRaw === undefined || marketingRaw === ''
        ? undefined
        : parseBooleanLoose(marketingRaw);

    const base = {
      name: String(row.name ?? '').trim(),
      email: row.email !== undefined ? String(row.email).trim() : undefined,
      phone: row.phone !== undefined ? String(row.phone).trim() : undefined,
      taxId: row.taxId !== undefined ? String(row.taxId).trim() : undefined,
      notes: row.notes !== undefined ? String(row.notes).trim() : undefined,
      legalName:
        row.legalName !== undefined ? String(row.legalName).trim() : undefined,
      cpf: row.cpf !== undefined ? String(row.cpf).trim() : undefined,
      whatsappWaId:
        row.whatsappWaId !== undefined
          ? String(row.whatsappWaId).trim()
          : undefined,
      marketingOptIn,
    };

    if (!base.name) throw new BadRequestException('name é obrigatório');

    const patch: UpdateCustomerDto = {
      name: base.name,
      email: base.email,
      phone: base.phone,
      taxId: base.taxId,
      notes: base.notes,
      legalName: base.legalName,
      cpf: base.cpf,
      whatsappWaId: base.whatsappWaId,
      marketingOptIn: base.marketingOptIn,
    };
    return {
      id,
      create: base as CreateCustomerDto,
      patch,
    };
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
      customerImportHeaderAliases(),
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
    let skipped = 0;

    for (let i = 0; i < items.length; i++) {
      const rowNum = i + 1;
      try {
        const { id, create, patch } = this.parseCustomerRow(items[i]);
        if (dryRun) {
          if (id && Types.ObjectId.isValid(id)) {
            const exists = await this.model
              .findOne({ _id: new Types.ObjectId(id), tenantId: new Types.ObjectId(tenantId) })
              .lean()
              .exec();
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
          const exists = await this.model
            .findOne({ _id: new Types.ObjectId(id), tenantId: new Types.ObjectId(tenantId) })
            .exec();
          if (!exists) {
            errors.push({ row: rowNum, message: `_id não encontrado: ${id}` });
            continue;
          }
          await this.model
            .findOneAndUpdate(
              { _id: new Types.ObjectId(id), tenantId: new Types.ObjectId(tenantId) },
              patch,
              { new: true },
            )
            .exec();
          updated++;
        } else {
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

  async findByWaId(tenantId: string, waId: string) {
    const doc = await this.model
      .findOne({ tenantId: new Types.ObjectId(tenantId), whatsappWaId: waId.trim() })
      .lean()
      .exec();
    return doc;
  }

  /** Fuzzy match for Gemini hints (first match). */
  async findFirstByHint(tenantId: string, hint: string) {
    const h = hint?.trim();
    if (!h) return null;
    const esc = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(esc, 'i');
    return this.model
      .findOne({
        tenantId: new Types.ObjectId(tenantId),
        $or: [{ name: re }, { email: re }, { phone: re }, { legalName: re }],
      })
      .lean()
      .exec();
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

  async update(tenantId: string, id: string, dto: UpdateCustomerDto) {
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

  async remove(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const res = await this.model
      .findOneAndDelete({ _id: new Types.ObjectId(id), tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!res) throw new NotFoundException();
    return { deleted: true };
  }
}
