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
}

export const OrderSchema = SchemaFactory.createForClass(Order);
OrderSchema.index({ tenantId: 1, createdAt: -1 });
