import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Address, AddressSchema } from './address.schema';

export type CustomerDocument = HydratedDocument<Customer>;

@Schema({ timestamps: true })
export class Customer {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true, lowercase: true })
  email?: string;

  @Prop({ trim: true })
  phone?: string;

  @Prop({ trim: true })
  taxId?: string;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ trim: true })
  legalName?: string;

  @Prop({ trim: true })
  cpf?: string;

  @Prop({ trim: true, index: true, sparse: true })
  whatsappWaId?: string;

  @Prop({ type: [AddressSchema], default: [] })
  addresses: Address[];

  @Prop({ type: Boolean, default: false })
  marketingOptIn: boolean;

  /** Saldo de crédito de loja (vale-troca) em reais, gerado por devoluções. */
  @Prop({ type: Number, default: 0 })
  storeCreditBalance: number;

  /** Pontos de fidelidade acumulados (ver módulo loyalty). */
  @Prop({ type: Number, default: 0 })
  loyaltyPoints: number;

  /** Tags livres pra segmentação (CRM). */
  @Prop({ type: [String], default: [] })
  tags: string[];

  /** Cliente-placeholder "Consumidor Final" do PDV (um por tenant). Fica fora
   * das listagens/exports do CRM e não acumula fidelidade. */
  @Prop({ type: Boolean, default: false })
  walkIn: boolean;

  /** Lista de desejos — IDs de Product salvos pelo cliente na loja. */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Product' }], default: [] })
  wishlist: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}

export const CustomerSchema = SchemaFactory.createForClass(Customer);
CustomerSchema.index({ tenantId: 1, createdAt: -1 });
CustomerSchema.index(
  { name: 'text', email: 'text', phone: 'text' },
  { weights: { name: 10, email: 5, phone: 5 }, name: 'customer_text_search' },
);
