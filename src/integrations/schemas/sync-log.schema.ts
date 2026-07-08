import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SyncLogDocument = HydratedDocument<SyncLog>;
export type SyncLogType = 'stock_push' | 'stock_pull' | 'product_push' | 'product_pull' | 'order_pull' | 'webhook_received';
export type SyncLogStatus = 'success' | 'error' | 'skipped';

@Schema({ timestamps: true, collection: 'synclogs' })
export class SyncLog {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Integration', required: true, index: true })
  integrationId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: ['stock_push', 'stock_pull', 'product_push', 'product_pull', 'order_pull', 'webhook_received'] })
  type: SyncLogType;

  @Prop({ type: String, required: true, enum: ['success', 'error', 'skipped'] })
  status: SyncLogStatus;

  @Prop({ type: Object })
  details?: Record<string, unknown>;

  @Prop()
  errorMessage?: string;

  @Prop()
  duration?: number;
}

export const SyncLogSchema = SchemaFactory.createForClass(SyncLog);
SyncLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 }); // 30 days TTL
