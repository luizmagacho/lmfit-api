import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MSchema, Types } from 'mongoose';

export type PurchaseStatus = 'interest' | 'order_reserved' | 'in_transit' | 'received' | 'cancelled';

export type PurchaseDocument = HydratedDocument<Purchase>;

const PurchaseLineSchema = new MSchema(
  {
    variantId: {
      type: Types.ObjectId,
      ref: 'ProductVariant',
      required: true,
    },
    quantityOrdered: { type: Number, required: true, min: 1 },
    quantityReceived: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

@Schema({ timestamps: true })
export class Purchase {
  @Prop({ type: Types.ObjectId, ref: 'Supplier', required: true })
  supplierId: Types.ObjectId;

  @Prop({ type: String, enum: ['interest', 'order_reserved', 'in_transit', 'received', 'cancelled'], default: 'interest' })
  status: PurchaseStatus;

  @Prop({ trim: true })
  reference?: string;

  @Prop({ type: Number, default: 0 })
  total: number;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: [PurchaseLineSchema], default: [] })
  lines: Array<{
    variantId: Types.ObjectId;
    quantityOrdered: number;
    quantityReceived: number;
  }>;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}

export const PurchaseSchema = SchemaFactory.createForClass(Purchase);
/** Index for purchases-daily report; expected query window ≤ 90 days. */
PurchaseSchema.index({ createdAt: 1 });
