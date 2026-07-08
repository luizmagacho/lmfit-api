import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MSchema, Types } from 'mongoose';

export type PurchaseStatus = 'pending' | 'started' | 'completed' | 'cancelled';

export type PurchaseDocument = HydratedDocument<Purchase>;

const PurchaseLineSchema = new MSchema(
  {
    variantId: {
      type: Types.ObjectId,
      ref: 'ProductVariant',
      sparse: true,
    },
    materialId: {
      type: Types.ObjectId,
      ref: 'Material',
      sparse: true,
    },
    rawName: { type: String, trim: true },
    unitPrice: { type: Number, default: 0 },
    quantityOrdered: { type: Number, required: true, min: 1 },
    quantityReceived: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

@Schema({ timestamps: true })
export class Purchase {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Supplier', required: true })
  supplierId: Types.ObjectId;

  @Prop({ type: String, enum: ['pending', 'started', 'completed', 'cancelled'], default: 'pending' })
  status: PurchaseStatus;

  @Prop({ trim: true })
  reference?: string;

  @Prop({ type: Number, default: 0 })
  total: number;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: [PurchaseLineSchema], default: [] })
  lines: Array<{
    variantId?: Types.ObjectId;
    materialId?: Types.ObjectId;
    rawName?: string;
    unitPrice: number;
    quantityOrdered: number;
    quantityReceived: number;
  }>;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}

export const PurchaseSchema = SchemaFactory.createForClass(Purchase);
/** Index for purchases-daily report; expected query window ≤ 90 days. */
PurchaseSchema.index({ createdAt: 1 });
PurchaseSchema.index({ tenantId: 1, createdAt: -1 });
