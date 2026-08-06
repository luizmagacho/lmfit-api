import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: true })
export class Address {
  @Prop({ trim: true })
  label?: string;

  @Prop({ trim: true, required: true })
  cep: string;

  @Prop({ trim: true, required: true })
  logradouro: string;

  @Prop({ trim: true })
  numero?: string;

  @Prop({ trim: true })
  complemento?: string;

  @Prop({ trim: true, required: true })
  bairro: string;

  @Prop({ trim: true, required: true })
  cidade: string;

  @Prop({ trim: true, required: true })
  uf: string;
}

export const AddressSchema = SchemaFactory.createForClass(Address);
