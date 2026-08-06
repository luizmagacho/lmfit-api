import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WhatsAppProcessingStatus =
  | 'received'
  | 'parsed'
  | 'auto_posted'
  | 'escalated'
  | 'failed'
  | 'ai_replied';

export type WhatsAppMessageDocument = HydratedDocument<WhatsAppMessage>;

@Schema({ timestamps: true })
export class WhatsAppMessage {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true, unique: true, index: true })
  wamid: string;

  @Prop({ required: true, trim: true, index: true })
  fromWaId: string;

  @Prop({ trim: true })
  type?: string;

  @Prop({ trim: true })
  textBody?: string;

  @Prop({ type: Object })
  rawPayload: Record<string, unknown>;

  @Prop({
    type: String,
    enum: ['received', 'parsed', 'auto_posted', 'escalated', 'failed', 'ai_replied'],
    default: 'received',
  })
  processingStatus: WhatsAppProcessingStatus;

  @Prop({ type: Object })
  geminiRaw?: Record<string, unknown>;

  @Prop({ type: Types.ObjectId, ref: 'Order' })
  linkedOrderId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Purchase' })
  linkedPurchaseId?: Types.ObjectId;

  @Prop({ trim: true })
  error?: string;
}

export const WhatsAppMessageSchema =
  SchemaFactory.createForClass(WhatsAppMessage);
WhatsAppMessageSchema.index({ fromWaId: 1, createdAt: -1 });
