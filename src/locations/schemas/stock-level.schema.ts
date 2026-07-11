import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type StockLevelDocument = HydratedDocument<StockLevel>;

/**
 * Per-location stock balance. `ProductVariant.quantityOnHand` remains the cached
 * total across all locations (kept in sync on every mutation) so existing reads
 * across API/web/mobile never need to change; this collection is the granular
 * source of truth for multi-location features (per-location view, transfers).
 */
@Schema({ timestamps: true })
export class StockLevel {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ProductVariant', required: true, index: true })
  variantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Location', required: true, index: true })
  locationId: Types.ObjectId;

  @Prop({ type: Number, required: true, default: 0 })
  quantity: number;
}

export const StockLevelSchema = SchemaFactory.createForClass(StockLevel);
StockLevelSchema.index({ tenantId: 1, variantId: 1, locationId: 1 }, { unique: true });
