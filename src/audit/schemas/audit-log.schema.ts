import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({ timestamps: true })
export class AuditLog {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  userId?: Types.ObjectId;

  /** Ex.: 'orders.update', 'fiscal.emit' — namespaced por módulo.ação. */
  @Prop({ required: true, trim: true, index: true })
  action: string;

  @Prop({ trim: true })
  resourceId?: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ tenantId: 1, createdAt: -1 });
