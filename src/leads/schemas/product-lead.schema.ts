import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProductLeadStatus = 'new' | 'contacted' | 'closed';

export type ProductLeadDocument = HydratedDocument<ProductLead>;

/**
 * Customer request for something outside the catalog but within the store's
 * product domain (e.g. a football-shirt store gets asked for a national-team
 * shirt it doesn't carry). Captured by the storefront chatbot so staff can
 * follow up — never auto-fulfilled.
 */
@Schema({ timestamps: true })
export class ProductLead {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  customerName: string;

  @Prop({ required: true, trim: true })
  customerPhone: string;

  @Prop({ required: true, trim: true })
  productDescription: string;

  @Prop({ type: String, enum: ['new', 'contacted', 'closed'], default: 'new' })
  status: ProductLeadStatus;

  @Prop({ trim: true, default: 'chat' })
  source: string;
}

export const ProductLeadSchema = SchemaFactory.createForClass(ProductLead);
ProductLeadSchema.index({ tenantId: 1, createdAt: -1 });
