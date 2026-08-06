import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MagicLinkTokenDocument = HydratedDocument<MagicLinkToken>;

@Schema({ timestamps: true })
export class MagicLinkToken {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true })
  customerId: Types.ObjectId;

  @Prop({ required: true, index: true })
  tokenHash: string;

  @Prop({ required: true, index: true })
  expiresAt: Date;

  /** Loop 18 — 'login' (default, comportamento original) vs. 'email-change': o mesmo mecanismo de
   *  link único/expira/hash-at-rest, só que provando posse do e-mail NOVO em vez de autenticar uma
   *  sessão existente. Sem isso, trocar de e-mail não tinha como confirmar que o cliente realmente
   *  tem acesso à caixa de entrada nova antes de gravar a mudança. */
  @Prop({ type: String, enum: ['login', 'email-change'], default: 'login' })
  purpose: 'login' | 'email-change';

  @Prop({ trim: true, lowercase: true })
  pendingEmail?: string;
}

export const MagicLinkTokenSchema = SchemaFactory.createForClass(MagicLinkToken);
MagicLinkTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
