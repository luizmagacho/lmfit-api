import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WhatsAppSenderDocument = HydratedDocument<WhatsAppSender>;

@Schema({ timestamps: true })
export class WhatsAppSender {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  waId: string;

  @Prop({ trim: true })
  label?: string;

  @Prop({ type: Boolean, default: false })
  allowed: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  linkedUserId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Supplier' })
  linkedSupplierId?: Types.ObjectId;

  @Prop({ trim: true })
  notes?: string;
}

export const WhatsAppSenderSchema = SchemaFactory.createForClass(WhatsAppSender);
WhatsAppSenderSchema.index({ tenantId: 1, waId: 1 }, { unique: true });
