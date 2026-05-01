import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MSchema, Types } from 'mongoose';
import { ORDER_CHANNELS } from '../types/order-channel';

export type OrderStatus =
  | 'draft'
  | 'pending_payment'
  | 'paid'
  | 'fulfilled'
  | 'cancelled';

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
    description: { type: String },
  },
  { _id: false },
);

@Schema({ timestamps: true })
export class Order {
  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true })
  customerId: Types.ObjectId;

  @Prop({
    type: String,
    enum: ORDER_CHANNELS,
    default: 'online',
    index: true,
  })
  channel: (typeof ORDER_CHANNELS)[number];

  @Prop({
    type: String,
    enum: ['draft', 'pending_payment', 'paid', 'fulfilled', 'cancelled'],
    default: 'draft',
  })
  status: OrderStatus;

  @Prop({ trim: true })
  reference?: string;

  @Prop({ type: Number, default: 0 })
  total: number;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: [OrderLineSchema], default: [] })
  lines: Array<{
    variantId: Types.ObjectId;
    quantity: number;
    unitPrice: number;
    description?: string;
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
