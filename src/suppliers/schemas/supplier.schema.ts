import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SupplierDocument = HydratedDocument<Supplier>;

@Schema({ timestamps: true })
export class Supplier {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  city?: string;

  @Prop({ trim: true, uppercase: true })
  state?: string;

  @Prop({ trim: true })
  websiteUrl?: string;

  @Prop({ trim: true })
  phone?: string;

  @Prop({ trim: true })
  taxId?: string;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}

export const SupplierSchema = SchemaFactory.createForClass(Supplier);
