import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WhatsAppSenderDocument = HydratedDocument<WhatsAppSender>;

@Schema({ timestamps: true })
export class WhatsAppSender {
  @Prop({ required: true, unique: true, trim: true })
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
WhatsAppSenderSchema.index({ waId: 1 }, { unique: true });
