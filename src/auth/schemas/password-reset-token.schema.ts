import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PasswordResetTokenDocument = HydratedDocument<PasswordResetToken>;

/** Mesmo padrão de `MagicLinkToken`/`RefreshToken`: token de alta entropia, só o hash SHA-256 fica
 *  em disco, `tenantId` sempre presente (o mesmo e-mail pode existir em tenants diferentes — ver
 *  índice único `{tenantId, email}` em `UserSchema` — então tanto a emissão quanto a verificação
 *  do token têm que estar sempre escopadas por tenant). Single-use: apagado ao ser consumido. */
@Schema({ timestamps: true })
export class PasswordResetToken {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, index: true })
  tokenHash: string;

  @Prop({ required: true, index: true })
  expiresAt: Date;
}

export const PasswordResetTokenSchema = SchemaFactory.createForClass(PasswordResetToken);
PasswordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
