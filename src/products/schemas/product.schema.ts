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

  /** Composição do tecido (ex.: "100% poliéster"). PDP v2 (Loop 5). */
  @Prop({ trim: true })
  composition?: string;

  /** Instruções de cuidado/lavagem. PDP v2 (Loop 5). */
  @Prop({ trim: true })
  careInstructions?: string;

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

  /** Quantidade mínima pra valer o preço de atacado. Sem preenchimento = 1 (qualquer
   * quantidade, inclusive uma peça só, pode ser vendida sem exigir um mínimo). */
  @Prop({ type: Number, default: 1 })
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

  /** 'ready_made' = comprado pronto de fornecedor (custo + margem definem o preço); 'manufactured' = produzido internamente (custo vem do módulo de produção). */
  @Prop({ type: String, enum: ['manufactured', 'ready_made'], default: 'manufactured' })
  sourceType: 'manufactured' | 'ready_made';

  /** Preço de custo — obrigatório quando sourceType = 'ready_made'. */
  @Prop({ type: Number })
  costPrice?: number;

  /** Margem sobre o custo em %, usada para derivar `priceRetail` quando sourceType = 'ready_made'. */
  @Prop({ type: Number })
  markupPercent?: number;

  /** Fornecedor do item pronto — obrigatório quando sourceType = 'ready_made'. */
  @Prop({ type: Types.ObjectId, ref: 'Supplier' })
  supplierId?: Types.ObjectId;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
ProductSchema.index({ tenantId: 1, slug: 1 }, { unique: true });
ProductSchema.index({ tenantId: 1, createdAt: -1 });
ProductSchema.index(
  { name: 'text', description: 'text', slug: 'text' },
  { weights: { name: 10, slug: 5, description: 1 }, name: 'product_text_search' },
);
