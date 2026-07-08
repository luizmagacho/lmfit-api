import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProductDocument = HydratedDocument<Product>;

@Schema({ timestamps: true })
export class Product {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ trim: true })
  category?: string;

  @Prop({ type: Boolean, default: true })
  active: boolean;

  /** Preço de varejo sugerido no nível produto (variante pode sobrescrever via `price`). */
  @Prop({ type: Number })
  priceRetail?: number;

  /** Atacado; omitido ou null na API = mesmo valor que varejo. */
  @Prop({ type: Number })
  priceWholesale?: number | null;

  @Prop({ type: Number, default: 6 })
  minWholesaleQty: number;

  @Prop({ type: Number })
  compareAtPrice?: number;

  /** URL canônica da imagem principal (HTTPS). Usada pelo grid e catálogo público. */
  @Prop({ trim: true })
  primaryImageUrl?: string;

  /** Galeria adicional (URLs simples). Se ausente, a UI deriva de variants[0].images. */
  @Prop({ type: [String], default: [] })
  images?: string[];

  /** EAN / GTIN. */
  @Prop({ trim: true })
  barcode?: string;

  /** Peso em gramas para cálculo de frete (Correios). */
  @Prop({ type: Number })
  weightGrams?: number;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
ProductSchema.index({ tenantId: 1, slug: 1 }, { unique: true });
ProductSchema.index({ tenantId: 1, createdAt: -1 });
