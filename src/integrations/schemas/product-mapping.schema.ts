import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProductMappingDocument = HydratedDocument<ProductMapping>;
export type MappingStatus = 'active' | 'paused' | 'error';

@Schema({ timestamps: true, collection: 'productmappings' })
export class ProductMapping {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Integration', required: true, index: true })
  integrationId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ProductVariant' })
  variantId?: Types.ObjectId;

  @Prop({ required: true })
  externalProductId: string;

  @Prop()
  externalVariantId?: string;

  @Prop()
  externalSku?: string;

  @Prop({ type: String, default: 'active', enum: ['active', 'paused', 'error'] })
  status: MappingStatus;
}

export const ProductMappingSchema = SchemaFactory.createForClass(ProductMapping);
ProductMappingSchema.index({ integrationId: 1, productId: 1, variantId: 1 });
ProductMappingSchema.index({ integrationId: 1, externalProductId: 1, externalVariantId: 1 });
