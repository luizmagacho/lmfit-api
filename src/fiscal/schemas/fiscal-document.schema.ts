import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FiscalDocumentType = 'nfce' | 'nfe';

export type FiscalDocumentStatus =
  | 'pending'
  | 'processing'
  | 'authorized'
  | 'rejected'
  | 'cancelled'
  | 'error';

export type FiscalDocumentDocument = HydratedDocument<FiscalDocument>;

@Schema({ timestamps: true })
export class FiscalDocument {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Order', required: true, index: true })
  orderId: Types.ObjectId;

  @Prop({ type: String, enum: ['nfce', 'nfe'], required: true })
  type: FiscalDocumentType;

  @Prop({
    type: String,
    enum: ['pending', 'processing', 'authorized', 'rejected', 'cancelled', 'error'],
    default: 'pending',
  })
  status: FiscalDocumentStatus;

  /** Nuvem Fiscal's document id, used to poll/cancel. */
  @Prop({ trim: true })
  providerId?: string;

  @Prop({ trim: true })
  chaveAcesso?: string;

  @Prop({ trim: true })
  xmlUrl?: string;

  @Prop({ trim: true })
  danfeUrl?: string;

  @Prop({ trim: true })
  qrCodeUrl?: string;

  @Prop({ type: Number, required: true })
  amount: number;

  @Prop({ trim: true })
  errorMessage?: string;

  @Prop()
  emittedAt?: Date;
}

export const FiscalDocumentSchema = SchemaFactory.createForClass(FiscalDocument);
FiscalDocumentSchema.index({ tenantId: 1, orderId: 1 });
