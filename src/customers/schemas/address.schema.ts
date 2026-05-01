import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class Address {
  @Prop({ trim: true })
  label?: string;

  @Prop({ trim: true })
  street?: string;

  @Prop({ trim: true })
  city?: string;

  @Prop({ trim: true })
  state?: string;

  @Prop({ trim: true })
  zip?: string;

  @Prop({ trim: true, default: 'BR' })
  country?: string;
}

export const AddressSchema = SchemaFactory.createForClass(Address);
