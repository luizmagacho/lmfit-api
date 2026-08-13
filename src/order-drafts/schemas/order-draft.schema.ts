import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MSchema, Types } from 'mongoose';

export type OrderDraftStatus =
  | 'collecting'
  | 'review'
  | 'submitted'
  | 'assigned';

export type OrderDraftDocument = HydratedDocument<OrderDraft>;

const DraftLineSchema = new MSchema(
  {
    variantId: { type: Types.ObjectId, ref: 'ProductVariant', required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    /** true = encomenda (excede o estoque, não deduz saldo); ver ProductVariant.acceptsBackorder. */
    isOrder: { type: Boolean, default: false },
  },
  { _id: false },
);

@Schema({ timestamps: true })
export class OrderDraft {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true, unique: true, index: true })
  sessionToken: string;

  @Prop({ type: Types.ObjectId, ref: 'Customer' })
  customerId?: Types.ObjectId;

  @Prop({ trim: true })
  waId?: string;

  @Prop({
    type: String,
    enum: ['collecting', 'review', 'submitted', 'assigned'],
    default: 'collecting',
  })
  status: OrderDraftStatus;

  @Prop({ type: [DraftLineSchema], default: [] })
  lines: Array<{
    variantId: Types.ObjectId;
    quantity: number;
    unitPrice: number;
    isOrder?: boolean;
  }>;

  @Prop({ trim: true })
  paymentMethodChoice?: string;

  @Prop({ trim: true })
  shippingMethod?: string;

  @Prop({ type: Number, default: 0 })
  shippingCost: number;

  /** CEP de destino (Loop 27) — só é obrigatório quando `shippingMethod` é uma cotação real da
   *  Melhor Envio (`"me:<id>"`); os 3 métodos fixos de sempre (pickup/standard/express) continuam
   *  não precisando de endereço nenhum. */
  @Prop({ trim: true })
  destinationCep?: string;

  /** Detalhe da cotação real escolhida (Loop 27) — só preenchido quando `shippingMethod` é `"me:*"`.
   *  Existe pra o valor mostrado no checkout nunca divergir do que vai pro pedido: `submitByToken`
   *  copia isto pro `Order`, nunca recalcula. */
  @Prop({ type: MSchema.Types.Mixed })
  shippingQuote?: {
    method: string;
    label: string;
    price: number;
    deliveryDays?: number;
  };

  @Prop({ trim: true, uppercase: true })
  couponCode?: string;

  @Prop({ type: Number, default: 0 })
  discountTotal: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedSalesUserId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Order' })
  orderId?: Types.ObjectId;

  @Prop({ type: MSchema.Types.Mixed })
  metadata?: Record<string, unknown>;

  /** Loop 16 — marca que o e-mail de carrinho abandonado já foi processado pra este rascunho (enviado
   *  ou pulado por falta de e-mail), pra nunca reprocessar o mesmo rascunho duas vezes. */
  @Prop({ type: Date })
  abandonedNotifiedAt?: Date;
}

export const OrderDraftSchema = SchemaFactory.createForClass(OrderDraft);
