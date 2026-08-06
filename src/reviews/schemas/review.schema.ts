import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export type ReviewDocument = HydratedDocument<Review>;

@Schema({ timestamps: true })
export class Review {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true })
  productId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true })
  customerId: Types.ObjectId;

  /** Pedido usado para validar a compra verificada — nunca exposto publicamente, só auditoria. */
  @Prop({ type: Types.ObjectId, ref: 'Order', required: true })
  orderId: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1, max: 5 })
  rating: number;

  @Prop({ trim: true, maxlength: 1000 })
  comment?: string;

  /** Nasce `pending` — só aparece publicamente depois que o staff aprova (mesmo padrão de
   *  moderação de `ReturnRecord`: solicitação do cliente nunca produz efeito imediato). */
  @Prop({ type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' })
  status: ReviewStatus;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reviewedBy?: Types.ObjectId;

  @Prop({ type: Date })
  reviewedAt?: Date;

  @Prop({ trim: true })
  rejectionNote?: string;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);
ReviewSchema.index({ tenantId: 1, productId: 1, status: 1 });
/** Um cliente só pode avaliar um produto uma vez. */
ReviewSchema.index({ tenantId: 1, customerId: 1, productId: 1 }, { unique: true });
