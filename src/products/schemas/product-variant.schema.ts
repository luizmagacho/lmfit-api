import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ProductImage, ProductImageSchema } from './product-image.schema';

export type ProductVariantDocument = HydratedDocument<ProductVariant>;

@Schema({ timestamps: true })
export class ProductVariant {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true })
  productId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  sku: string;

  @Prop({ trim: true })
  color?: string;

  @Prop({ trim: true })
  size?: string;

  /** Preço de varejo (canônico; legado lmfit-web também envia como `price`). */
  @Prop({ type: Number, default: 0 })
  price: number;

  /** Atacado por variante; omitido → herdar do produto; null explícito = varejo. */
  @Prop({ type: Number })
  priceWholesale?: number | null;

  /** Mínimo de peças para badge atacado; omitido → herdar do produto. */
  @Prop({ type: Number })
  minWholesaleQty?: number;

  @Prop({ type: Number })
  compareAtPrice?: number;

  @Prop({ trim: true })
  barcode?: string;

  @Prop({ type: Number, default: 0 })
  quantityOnHand: number;

  @Prop({ type: Number, default: 0 })
  reorderPoint: number;

  @Prop({ type: [ProductImageSchema], default: [] })
  images: ProductImage[];
}

export const ProductVariantSchema = SchemaFactory.createForClass(ProductVariant);
ProductVariantSchema.index({ tenantId: 1, sku: 1 }, { unique: true });
ProductVariantSchema.index({ productId: 1 });
