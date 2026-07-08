import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** Canonical + legacy DB values (legacy kept for reads / unmigrated docs). */
export type InvoiceStatus =
  | 'pending'
  | 'paid'
  | 'overdue'
  | 'cancelled'
  | 'open'
  | 'void';

export type InvoiceDocument = HydratedDocument<Invoice>;

const INVOICE_STATUS_ENUM: InvoiceStatus[] = [
  'pending',
  'paid',
  'overdue',
  'cancelled',
  'open',
  'void',
];

@Schema({ timestamps: true })
export class Invoice {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ trim: true, sparse: true })
  number?: string;

  @Prop({ type: String, enum: INVOICE_STATUS_ENUM, default: 'pending' })
  status: InvoiceStatus;

  @Prop({ type: Number, required: true, default: 0 })
  amount: number;

  @Prop({ type: Date })
  dueDate?: Date;

  @Prop({ type: Types.ObjectId, ref: 'Order' })
  orderId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Purchase' })
  purchaseId?: Types.ObjectId;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);
InvoiceSchema.index({ tenantId: 1, createdAt: -1 });
