import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLog } from './schemas/audit-log.schema';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLog.name) private readonly model: Model<AuditLog>,
  ) {}

  /** Fire-and-forget: uma mutação não pode falhar por causa do log de auditoria. */
  record(entry: {
    tenantId?: string;
    userId?: string;
    action: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  }): void {
    if (!entry.tenantId || !Types.ObjectId.isValid(entry.tenantId)) return;
    this.model
      .create({
        tenantId: new Types.ObjectId(entry.tenantId),
        userId:
          entry.userId && Types.ObjectId.isValid(entry.userId)
            ? new Types.ObjectId(entry.userId)
            : undefined,
        action: entry.action,
        resourceId: entry.resourceId,
        metadata: entry.metadata,
      })
      .catch((err) =>
        this.logger.warn(`Falha ao gravar audit log (${entry.action}): ${err?.message}`),
      );
  }

  async listForTenant(tenantId: string, page: number, limit: number, action?: string) {
    const filter: Record<string, unknown> = { tenantId: new Types.ObjectId(tenantId) };
    if (action) filter.action = action;
    const skip = (Math.max(page, 1) - 1) * limit;
    const [items, total] = await Promise.all([
      this.model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items, total, page, limit };
  }
}
