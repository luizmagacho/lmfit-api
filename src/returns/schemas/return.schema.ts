import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MSchema, Types } from 'mongoose';

export type ReturnType = 'return' | 'exchange' | 'refund';
export type ReturnStatus = 'requested' | 'approved' | 'rejected' | 'completed';
export type ReturnRequestedBy = 'staff' | 'customer';

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
   * 'refund' (Loop 17) devolve estoque + marca o `Payment` do pedido como estornado
   * (`refundedAt`/`refundAmount`/`refundedBy`) — sem crédito de loja e sem nenhuma chamada de API
   * de estorno: o funcionário estorna por fora (InfinitePay/manualmente) e só registra aqui.
   */
  @Prop({ type: String, enum: ['return', 'exchange', 'refund'], required: true })
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

  /**
   * Devoluções criadas pelo staff (`create()`, endpoint já existente) continuam executando na
   * hora — `status` nasce `'completed'`, comportamento inalterado. Uma solicitação feita pelo
   * cliente (`/devolucoes` ou `/me/returns`) nasce `'requested'`: sem reversão de estoque nem
   * crédito até o staff aprovar (`approve()`), que só então roda o mesmo efeito.
   */
  @Prop({ type: String, enum: ['requested', 'approved', 'rejected', 'completed'], default: 'completed' })
  status: ReturnStatus;

  @Prop({ type: String, enum: ['staff', 'customer'], default: 'staff' })
  requestedBy: ReturnRequestedBy;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reviewedBy?: Types.ObjectId;

  @Prop({ type: Date })
  reviewedAt?: Date;

  @Prop({ trim: true })
  rejectionNote?: string;

  /** Variante desejada em troca (`type: 'exchange'`) — apenas informativo; o staff ainda cria o
   *  pedido novo manualmente ao aprovar (ver comentário em `type` acima). */
  @Prop({ type: Types.ObjectId, ref: 'ProductVariant' })
  desiredVariantId?: Types.ObjectId;
}

export const ReturnSchema = SchemaFactory.createForClass(ReturnRecord);
ReturnSchema.index({ tenantId: 1, createdAt: -1 });
