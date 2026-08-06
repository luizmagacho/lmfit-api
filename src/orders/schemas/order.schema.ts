import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MSchema, Types } from 'mongoose';
import { ORDER_CHANNELS } from '../types/order-channel';

export type OrderStatus =
  | 'open'
  | 'picking'
  | 'shipped'
  | 'completed'
  | 'cancelled'
  | 'encomendado_pago'
  | 'encomendado_nao_pago';

export type OrderDocument = HydratedDocument<Order>;

const OrderLineSchema = new MSchema(
  {
    variantId: {
      type: Types.ObjectId,
      ref: 'ProductVariant',
      required: true,
    },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    productionPrice: { type: Number, default: 0 },
    description: { type: String },
    isOrder: { type: Boolean, default: false },
    /** Soma de unidades já devolvidas/trocadas desta linha (ver módulo returns). */
    returnedQty: { type: Number, default: 0 },
  },
  { _id: false },
);

@Schema({ timestamps: true })
export class Order {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true })
  customerId: Types.ObjectId;

  @Prop({ type: Number, index: true })
  number: number;

  @Prop({
    type: String,
    enum: ORDER_CHANNELS,
    default: 'online',
    index: true,
  })
  channel: (typeof ORDER_CHANNELS)[number];

  @Prop({
    type: String,
    enum: ['open', 'picking', 'shipped', 'completed', 'cancelled', 'encomendado_pago', 'encomendado_nao_pago'],
    default: 'open',
  })
  status: OrderStatus;

  @Prop({ trim: true })
  reference?: string;

  @Prop({ type: Number, default: 0 })
  total: number;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ trim: true })
  shippingMethod?: string;

  @Prop({ type: Number, default: 0 })
  shippingCost: number;

  @Prop({ trim: true, uppercase: true })
  couponCode?: string;

  @Prop({ type: Number, default: 0 })
  discountTotal: number;

  /** Crédito de loja (`Customer.storeCreditBalance`) aplicado neste pedido (Loop 9) — dedução
   *  final, tipo vale-presente, já deduzida atomicamente do saldo no momento do submit. */
  @Prop({ type: Number, default: 0 })
  creditApplied: number;

  @Prop({ type: [OrderLineSchema], default: [] })
  lines: Array<{
    variantId: Types.ObjectId;
    quantity: number;
    unitPrice: number;
    productionPrice?: number;
    description?: string;
    isOrder?: boolean;
    returnedQty?: number;
  }>;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  /** PDV: usuário que operou a venda. */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  operatorUserId?: Types.ObjectId;

  @Prop({ type: String, enum: ['pix', 'cash', 'card'] })
  paymentMethod?: 'pix' | 'cash' | 'card';

  /** Marca que o e-mail "seu pedido foi enviado" já foi disparado (Loop 8) — evita reenvio se o
   *  status voltar a passar por 'shipped' (ou for salvo de novo com o mesmo status). */
  @Prop({ type: Date })
  shippedNotifiedAt?: Date;

  /** Rastreio real (Loop 17) — preenchido pelo staff ao marcar o pedido como enviado;
   *  `shippingMethod` continua sendo o texto livre de método de entrega, sem relação com isto. */
  @Prop({ trim: true })
  carrier?: string;

  @Prop({ trim: true })
  trackingCode?: string;

  @Prop({ trim: true })
  trackingUrl?: string;

  /** Local de venda (PDV offline) — ausente para pedidos sem local específico (continuam
   *  batendo no local padrão do tenant, ver LocationsService). */
  @Prop({ type: Types.ObjectId, ref: 'Location' })
  locationId?: Types.ObjectId;

  /** Chave de idempotência gerada no cliente (PDV offline, `POST /orders/sync-batch`) —
   *  reenviar o mesmo lote nunca cria um pedido duplicado. Ausente para pedidos criados
   *  pelos caminhos normais (online/admin), por isso o índice é esparso. */
  @Prop({ trim: true })
  clientSaleId?: string;

  /** Marcado quando a sincronização converteu automaticamente parte de uma venda offline em
   *  encomenda por falta de estoque real no local no momento do envio (ver `syncBatch`). */
  @Prop({ type: Date })
  autoBackorderedAt?: Date;

  @Prop({ trim: true })
  autoBackorderNote?: string;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
OrderSchema.index({ tenantId: 1, createdAt: -1 });
OrderSchema.index({ tenantId: 1, clientSaleId: 1 }, { unique: true, sparse: true });
