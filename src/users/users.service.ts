import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as argon2 from 'argon2';
import { Model, Types } from 'mongoose';
import type { StaffImportResponse } from '../common/dto/staff-import.response';
import { ExcelSpreadsheetService } from '../common/excel/excel-spreadsheet.service';
import type { UserDocument, UserRole } from './schemas/user.schema';
import { User } from './schemas/user.schema';
import { USER_ROLE_VALUES } from './schemas/user.schema';
import { USER_EXPORT_COLUMNS, userImportHeaderAliases } from './user-excel.constants';
import { escapeRegex } from '../common/utils/text-search.util';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly excel: ExcelSpreadsheetService,
  ) {}

  async count(tenantId?: string): Promise<number> {
    const q = tenantId ? { tenantId: new Types.ObjectId(tenantId) } : {};
    return this.userModel.countDocuments(q).exec();
  }

  /** Maps legacy `finance` / `ops` to `staff` once per deploy. */
  async migrateLegacyRoles(): Promise<void> {
    await this.userModel.updateMany({ role: 'finance' }, { $set: { role: 'staff' } }).exec();
    await this.userModel.updateMany({ role: 'ops' }, { $set: { role: 'staff' } }).exec();
  }

  async seedAdminIfEmpty(
    email: string,
    password: string,
    name = 'Admin',
  ): Promise<void> {
    const n = await this.count(undefined);
    if (n > 0) return;
    const tenantModel = this.userModel.db.model('Tenant');
    let tenant = await tenantModel.findOne({ slug: 'lmfit' }).exec();
    if (!tenant) {
      tenant = await tenantModel.create({
        slug: 'lmfit',
        name: 'LMFit Store',
        active: true,
        plan: 'enterprise',
        branding: {
          logoUrl: 'https://d1a9qnv764bsoo.cloudfront.net/stores/006/316/201/themes/common/logo-813858800-1750428827-d18edfd75754df23704c77cbd129bbc91750428827-1024-1024.webp?w=1400',
          faviconUrl: 'https://d1a9qnv764bsoo.cloudfront.net/stores/006/316/201/themes/common/logo-813858800-1750428827-d18edfd75754df23704c77cbd129bbc91750428827-1024-1024.webp?w=1400',
          primaryColor: '#f68006',
          secondaryColor: '#000000',
          darkMode: false,
        },
      });
    }
    const passwordHash = await argon2.hash(password);
    await this.userModel.create({
      email: email.toLowerCase(),
      passwordHash,
      name,
      role: 'admin' as UserRole,
      tenantId: tenant._id,
    });
  }

  async findByEmail(tenantId: string | undefined, email: string): Promise<UserDocument | null> {
    const q: Record<string, any> = { email: email.toLowerCase() };
    if (tenantId) {
      q.tenantId = new Types.ObjectId(tenantId);
    }
    return this.userModel.findOne(q).exec();
  }

  async findById(tenantId: string | undefined, id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const q: Record<string, any> = { _id: new Types.ObjectId(id) };
    if (tenantId) {
      q.tenantId = new Types.ObjectId(tenantId);
    }
    return this.userModel.findOne(q).exec();
  }

  async findByIdPublic(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.userModel
      .findOne({ _id: new Types.ObjectId(id), tenantId: new Types.ObjectId(tenantId) })
      .select('-passwordHash')
      .lean()
      .exec();
  }

  private listFilter(tenantId: string, search?: string) {
    const base: Record<string, any> = { tenantId: new Types.ObjectId(tenantId) };
    if (search) {
      const safe = escapeRegex(search);
      base.$or = [
        { name: new RegExp(safe, 'i') },
        { email: new RegExp(safe, 'i') },
      ];
    }
    return base;
  }

  async list(tenantId: string, skip: number, limit: number, search?: string) {
    const q = this.listFilter(tenantId, search);
    const [items, total] = await Promise.all([
      this.userModel
        .find(q)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-passwordHash')
        .lean()
        .exec(),
      this.userModel.countDocuments(q).exec(),
    ]);
    return { items, total };
  }

  async findAllForExport(tenantId: string, search?: string) {
    const q = this.listFilter(tenantId, search);
    return this.userModel
      .find(q)
      .sort({ createdAt: -1 })
      .select('-passwordHash')
      .lean()
      .exec();
  }

  serializeUserRow(doc: Record<string, unknown>): Record<string, unknown> {
    const o: Record<string, unknown> = { ...doc };
    if (o._id) o._id = String(o._id);
    o.password = '';
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
      this.serializeUserRow(d as unknown as Record<string, unknown>),
    );
    const buffer =
      format === 'csv'
        ? this.excel.buildCsvBuffer(USER_EXPORT_COLUMNS, rows)
        : await this.excel.buildXlsxBuffer('Usuários', USER_EXPORT_COLUMNS, rows);
    return {
      buffer,
      filename: `users.${format === 'csv' ? 'csv' : 'xlsx'}`,
      mime:
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private parseRole(v: unknown): UserRole {
    const r = String(v ?? 'staff')
      .trim()
      .toLowerCase();
    if (r === 'finance' || r === 'ops') return 'staff';
    if ((USER_ROLE_VALUES as readonly string[]).includes(r)) {
      return r as UserRole;
    }
    throw new BadRequestException(
      `role inválido; use um de: ${USER_ROLE_VALUES.join(', ')}`,
    );
  }

  private parseUserRow(row: Record<string, unknown>): {
    id?: string;
    create?: { email: string; password: string; name: string; role: UserRole };
    patch: { name?: string; role?: UserRole; password?: string };
  } {
    const idRaw = row._id ?? row.id;
    const id =
      idRaw !== undefined && idRaw !== '' && String(idRaw).length === 24
        ? String(idRaw)
        : undefined;
    const name = String(row.name ?? '').trim();
    const email = String(row.email ?? '')
      .trim()
      .toLowerCase();
    const password = String(row.password ?? '').trim();

    if (id) {
      const patch: { name?: string; role?: UserRole; password?: string } = {};
      if (name) patch.name = name;
      if (row.role !== undefined && String(row.role).trim() !== '') {
        patch.role = this.parseRole(row.role);
      }
      if (password.length > 0) {
        if (password.length < 6) {
          throw new BadRequestException('password deve ter no mínimo 6 caracteres');
        }
        patch.password = password;
      }
      return { id, patch };
    }

    const role = this.parseRole(row.role);
    if (!email) throw new BadRequestException('email é obrigatório');
    if (!name) throw new BadRequestException('name é obrigatório');
    if (password.length < 6) {
      throw new BadRequestException(
        'password é obrigatório (mín. 6 caracteres) para novos usuários',
      );
    }
    return {
      id,
      create: { email, password, name, role },
      patch: {},
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
      userImportHeaderAliases(),
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
        const { id, create, patch } = this.parseUserRow(items[i]);
        if (dryRun) {
          if (id && Types.ObjectId.isValid(id)) {
            const exists = await this.userModel
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
          continue;
        }
        if (id && Types.ObjectId.isValid(id)) {
          const exists = await this.userModel
            .findOne({ _id: new Types.ObjectId(id), tenantId: new Types.ObjectId(tenantId) })
            .exec();
          if (!exists) {
            errors.push({ row: rowNum, message: `_id não encontrado: ${id}` });
            continue;
          }
          if (Object.keys(patch).length === 0) {
            skipped++;
            continue;
          }
          await this.update(tenantId, id, patch);
          updated++;
        } else {
          if (!create) {
            errors.push({ row: rowNum, message: 'Linha inválida' });
            continue;
          }
          await this.create(tenantId, { ...create, createdBy });
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

  async create(
    tenantId: string,
    data: {
      email: string;
      password: string;
      name: string;
      role: UserRole;
      createdBy?: string;
    },
  ) {
    const passwordHash = await argon2.hash(data.password);
    const doc = await this.userModel.create({
      tenantId: new Types.ObjectId(tenantId),
      email: data.email.toLowerCase(),
      passwordHash,
      name: data.name,
      role: data.role,
      createdBy: data.createdBy ? new Types.ObjectId(data.createdBy) : undefined,
    });
    const o = doc.toObject();
    delete (o as { passwordHash?: string }).passwordHash;
    return o;
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<{ name: string; role: UserRole; password: string }>,
  ) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('User not found');
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.role !== undefined) update.role = patch.role;
    if (patch.password) update.passwordHash = await argon2.hash(patch.password);
    const doc = await this.userModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), tenantId: new Types.ObjectId(tenantId) },
        update,
        { new: true },
      )
      .select('-passwordHash')
      .lean()
      .exec();
    if (!doc) throw new NotFoundException('User not found');
    return doc;
  }

  async remove(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('User not found');
    const res = await this.userModel
      .findOneAndDelete({ _id: new Types.ObjectId(id), tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!res) throw new NotFoundException('User not found');
    return { deleted: true };
  }
}
