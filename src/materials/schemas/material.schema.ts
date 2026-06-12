import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MaterialDocument = HydratedDocument<Material>;

@Schema({ timestamps: true })
export class Material {
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
MaterialSchema.index({ name: 1 });
