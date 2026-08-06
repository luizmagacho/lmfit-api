import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type InfluencerDocument = HydratedDocument<Influencer>;

/** Um influenciador/afiliado — ganha um ou mais cupons próprios (`Promotion.influencerId`) pra
 *  que vendas usando esse código fiquem atribuídas a ele nos relatórios. Não tem login nem acesso
 *  próprio (100% back-office, painel do lojista) — é só uma entidade de referência, no molde de
 *  `Supplier`. */
@Schema({ timestamps: true })
export class Influencer {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  instagramHandle?: string;

  @Prop({ trim: true })
  email?: string;

  @Prop({ trim: true })
  phone?: string;

  /** Percentual de comissão — dado real pra um futuro fechamento de repasse, sem cálculo
   *  automático ainda nesta v1. */
  @Prop({ min: 0, max: 100 })
  commissionRate?: number;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ default: true })
  active: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}

export const InfluencerSchema = SchemaFactory.createForClass(Influencer);
