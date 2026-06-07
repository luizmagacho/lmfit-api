import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Address, AddressSchema } from './address.schema';

export type CustomerDocument = HydratedDocument<Customer>;

@Schema({ timestamps: true })
export class Customer {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true, lowercase: true })
  email?: string;

  @Prop({ trim: true })
  phone?: string;

  @Prop({ trim: true })
  taxId?: string;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ trim: true })
  legalName?: string;

  @Prop({ trim: true })
  cpf?: string;

  @Prop({ trim: true, index: true, sparse: true })
  whatsappWaId?: string;

  @Prop({ type: [AddressSchema], default: [] })
  addresses: Address[];

  @Prop({ type: Boolean, default: false })
  marketingOptIn: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}

export const CustomerSchema = SchemaFactory.createForClass(Customer);
