import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PromotionType = 'percent' | 'fixed';

export type PromotionDocument = HydratedDocument<Promotion>;

@Schema({ timestamps: true })
export class Promotion {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true, uppercase: true, trim: true })
  code: string;

  @Prop({ type: String, enum: ['percent', 'fixed'], required: true })
  type: PromotionType;

  /** Percentual (0-100) se type='percent', valor em reais se type='fixed'. */
  @Prop({ type: Number, required: true, min: 0 })
  value: number;

  /** Subtotal mínimo do carrinho pra cupom valer. */
  @Prop({ type: Number })
  minSubtotal?: number;

  @Prop({ type: Date })
  validFrom?: Date;

  @Prop({ type: Date })
  validUntil?: Date;

  @Prop({ type: Number })
  maxUses?: number;

  @Prop({ type: Number, default: 0 })
  usedCount: number;

  @Prop({ type: Boolean, default: true })
  active: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  /** Influenciador dono deste cupom, pra atribuição de vendas no relatório (Programa de
   *  Influenciadores) — opcional, muitos-pra-um (um influenciador pode ter vários cupons ao longo
   *  do tempo). `Order` não guarda `promotionId`, só `couponCode` — o relatório cruza por
   *  `{tenantId, code}` pra achar este campo. */
  @Prop({ type: Types.ObjectId, ref: 'Influencer' })
  influencerId?: Types.ObjectId;
}

export const PromotionSchema = SchemaFactory.createForClass(Promotion);
PromotionSchema.index({ tenantId: 1, code: 1 }, { unique: true });
