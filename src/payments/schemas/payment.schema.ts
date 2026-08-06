import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PaymentStatus = 'pending' | 'paid' | 'expired' | 'failed' | 'cancelled';

export type PaymentDocument = HydratedDocument<Payment>;

@Schema({ timestamps: true })
export class Payment {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Order', required: true, index: true })
  orderId: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['pending', 'paid', 'expired', 'failed', 'cancelled'],
    default: 'pending',
    index: true,
  })
  status: PaymentStatus;

  @Prop({ type: String, enum: ['pix', 'infinitepay'], required: true })
  method: 'pix' | 'infinitepay';

  @Prop({ type: Number, required: true })
  amount: number;

  @Prop({ trim: true })
  qrCode?: string;

  @Prop({ trim: true })
  qrCodeImage?: string;

  @Prop({ type: Date })
  expiresAt?: Date;

  @Prop({ trim: true })
  checkoutUrl?: string;

  @Prop({ type: Date })
  paidAt?: Date;

  @Prop({ trim: true })
  transactionNsu?: string;

  @Prop({ trim: true })
  captureMethod?: string;

  /**
   * Loop 17 — estorno registrado manualmente: o funcionário estorna na InfinitePay (ou combina
   * diretamente com o cliente) e só então marca aqui. Nenhuma chamada de API de estorno é feita —
   * não existe endpoint de estorno da InfinitePay disponível/confirmado neste projeto.
   */
  @Prop({ type: Date })
  refundedAt?: Date;

  @Prop({ type: Number })
  refundAmount?: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  refundedBy?: Types.ObjectId;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ orderId: 1, status: 1 });
PaymentSchema.index({ tenantId: 1, createdAt: -1 });
