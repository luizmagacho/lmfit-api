import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CustomerRefreshTokenDocument = HydratedDocument<CustomerRefreshToken>;

@Schema({ timestamps: true })
export class CustomerRefreshToken {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true })
  customerId: Types.ObjectId;

  @Prop({ required: true, index: true })
  tokenHash: string;

  @Prop({ required: true, index: true })
  expiresAt: Date;
}

export const CustomerRefreshTokenSchema = SchemaFactory.createForClass(CustomerRefreshToken);
CustomerRefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
