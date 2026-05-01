import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type StockReason =
  | 'adjustment'
  | 'sale'
  | 'sale_reversal'
  | 'purchase_receipt'
  | 'return'
  | 'initial';

export type StockLedgerDocument = HydratedDocument<StockLedger>;

@Schema({ timestamps: true })
export class StockLedger {
  @Prop({ type: Types.ObjectId, ref: 'ProductVariant', required: true, index: true })
  variantId: Types.ObjectId;

  @Prop({ type: Number, required: true })
  delta: number;

  @Prop({
    type: String,
    enum: [
      'adjustment',
      'sale',
      'sale_reversal',
      'purchase_receipt',
      'return',
      'initial',
    ],
    required: true,
  })
  reason: StockReason;

  @Prop({ trim: true })
  note?: string;

  @Prop({ type: Types.ObjectId, ref: 'Order' })
  orderId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}

export const StockLedgerSchema = SchemaFactory.createForClass(StockLedger);
