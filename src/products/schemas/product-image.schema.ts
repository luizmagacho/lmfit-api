import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class ProductImage {
  @Prop({ required: true, trim: true })
  url: string;

  @Prop({ type: Number, default: 0 })
  sort: number;

  @Prop({ trim: true })
  alt?: string;
}

export const ProductImageSchema = SchemaFactory.createForClass(ProductImage);
