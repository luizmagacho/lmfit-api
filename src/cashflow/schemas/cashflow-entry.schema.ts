import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CashflowEntryDocument = HydratedDocument<CashflowEntry>;

export type TransactionType =
  | 'deposit_sales'
  | 'pix_received'
  | 'pix_sent'
  | 'other';

export type AiAnalysis = {
  category?: string;
  customerHint?: string;
  confidence?: number;
  notes?: string;
  reconciled?: boolean;
};

@Schema({ timestamps: true })
export class CashflowEntry {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true })
  date: Date;

  @Prop({ trim: true })
  hour?: string;

  @Prop({
    required: true,
    enum: ['deposit_sales', 'pix_received', 'pix_sent', 'other'],
  })
  type: TransactionType;

  @Prop({ trim: true })
  name?: string;

  @Prop({ trim: true })
  detail?: string;

  /** Positive = credit, Negative = debit */
  @Prop({ required: true })
  amount: number;

  @Prop({ default: 'infinitepay', trim: true })
  source: string;

  /** UUID that groups all entries from the same import batch */
  @Prop({ required: true, index: true })
  importBatch: string;

  @Prop()
  periodFrom?: Date;

  @Prop()
  periodTo?: Date;

  /** Linked customer (resolved manually or via AI) */
  @Prop({ type: Types.ObjectId, ref: 'Customer', index: true, sparse: true })
  customerId?: Types.ObjectId;

  /** Linked supplier */
  @Prop({ type: Types.ObjectId, ref: 'Supplier', index: true, sparse: true })
  supplierId?: Types.ObjectId;

  /** Linked order */
  @Prop({ type: Types.ObjectId, ref: 'Order', index: true, sparse: true })
  orderId?: Types.ObjectId;

  @Prop({ type: Object })
  aiAnalysis?: AiAnalysis;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}

export const CashflowEntrySchema = SchemaFactory.createForClass(CashflowEntry);
