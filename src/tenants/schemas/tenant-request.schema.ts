import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TenantRequestDocument = HydratedDocument<TenantRequest>;

@Schema({ timestamps: true })
export class TenantRequest {
  @Prop({ required: true, trim: true })
  storeName: string;

  @Prop({ required: true, trim: true })
  ownerName: string;

  @Prop({ required: true, trim: true, lowercase: true })
  ownerEmail: string;

  @Prop({ required: true, trim: true })
  ownerPhone: string;

  @Prop({ required: true, trim: true, lowercase: true })
  desiredDomain: string;

  @Prop({ required: true, enum: ['pending', 'approved', 'rejected'], default: 'pending' })
  status: string;
}

export const TenantRequestSchema = SchemaFactory.createForClass(TenantRequest);
