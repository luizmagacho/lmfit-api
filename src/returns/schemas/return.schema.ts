import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MSchema, Types } from 'mongoose';

export type ReturnType = 'return' | 'exchange';

export type ReturnDocument = HydratedDocument<ReturnRecord>;

const ReturnLineSchema = new MSchema(
  {
    variantId: { type: Types.ObjectId, ref: 'ProductVariant', required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    reason: { type: String, trim: true },
  },
  { _id: false },
);

@Schema({ timestamps: true, collection: 'returns' })
export class ReturnRecord {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Order', required: true, index: true })
  orderId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true })
  customerId: Types.ObjectId;

  /**
   * 'return' devolve estoque + gera crédito de loja no cliente.
   * 'exchange' devolve estoque da linha trocada, sem crédito — a nova
   * variante é vendida num pedido novo criado à parte pelo operador,
   * referenciando este returnId em `reference` (evita reabrir o total
   * já pago do pedido original).
   */
  @Prop({ type: String, enum: ['return', 'exchange'], required: true })
  type: ReturnType;

  @Prop({ type: [ReturnLineSchema], default: [] })
  lines: Array<{
    variantId: Types.ObjectId;
    quantity: number;
    unitPrice: number;
    reason?: string;
  }>;

  @Prop({ type: Number, default: 0 })
  creditIssued: number;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}

export const ReturnSchema = SchemaFactory.createForClass(ReturnRecord);
ReturnSchema.index({ tenantId: 1, createdAt: -1 });
