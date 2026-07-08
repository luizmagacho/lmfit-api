import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MaterialDocument = HydratedDocument<Material>;

@Schema({ timestamps: true })
export class Material {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  unit: string; // e.g. "un", "m", "kg", "ro"

  @Prop({ type: Number, default: 0 })
  quantityOnHand: number;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: Boolean, default: true })
  active: boolean;
}

export const MaterialSchema = SchemaFactory.createForClass(Material);
MaterialSchema.index({ tenantId: 1, name: 1 });
