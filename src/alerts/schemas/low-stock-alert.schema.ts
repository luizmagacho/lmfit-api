import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type LowStockAlertDocument = HydratedDocument<LowStockAlert>;

@Schema({ timestamps: true })
export class LowStockAlert {
  @Prop({ type: Types.ObjectId, ref: 'ProductVariant', required: true, index: true })
  variantId: Types.ObjectId;

  @Prop({ type: Number, required: true })
  onHandSnapshot: number;

  @Prop({ type: Number, required: true })
  reorderPointSnapshot: number;
}

export const LowStockAlertSchema = SchemaFactory.createForClass(LowStockAlert);
LowStockAlertSchema.index({ variantId: 1, createdAt: -1 });
