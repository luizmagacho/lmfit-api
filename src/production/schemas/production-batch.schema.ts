import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MSchema, Types } from 'mongoose';

export type ProductionBatchDocument = HydratedDocument<ProductionBatch>;

export type BatchStatus = string; // customizable by user

/** Insumo utilizado no lote (tecido, aviamento, etc.) */
const InputItemSchema = new MSchema(
  {
    description: { type: String, required: true, trim: true },
    inputType: {
      type: String,
      enum: ['fabric', 'lining', 'zipper', 'button', 'elastic', 'thread', 'label', 'packaging', 'other'],
      default: 'other',
    },
    unit: {
      type: String,
      enum: ['kg', 'm', 'm2', 'unit', 'roll', 'dozen', 'pack'],
      default: 'unit',
    },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    totalCost: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

@Schema({ timestamps: true })
export class ProductionBatch {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  /** Nome ou referência do lote (ex: "Legging Preta P/M - Maio 2026") */
  @Prop({ required: true, trim: true })
  name: string;

  /** SKU ou código do produto/peça */
  @Prop({ trim: true })
  sku?: string;

  /** Quantidade de peças produzidas no lote */
  @Prop({ required: true, min: 1 })
  batchQty: number;

  /** Status do lote (customizável: "Planejado", "Corte", "Costura", "Acabamento", "Pronto") */
  @Prop({ type: String, default: 'Planejado' })
  status: string;

  /** Insumos utilizados (tecido, aviamentos, etc.) */
  @Prop({ type: [InputItemSchema], default: [] })
  inputs: Array<{
    description: string;
    inputType: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    totalCost: number;
  }>;

  /** Custo total de corte para o lote inteiro */
  @Prop({ type: Number, default: 0 })
  cuttingCost: number;

  /** Custo total de costura para o lote inteiro */
  @Prop({ type: Number, default: 0 })
  sewingCost: number;

  /** Overhead em percentual (%) sobre (MP + MO) — ex: 10 = 10% */
  @Prop({ type: Number, default: 0 })
  overheadPercent: number;

  /** Custo total de insumos (MP + aviamentos) — calculado */
  @Prop({ type: Number, default: 0 })
  totalInputsCost: number;

  /** Custo total do lote = insumos + corte + costura + overhead */
  @Prop({ type: Number, default: 0 })
  totalBatchCost: number;

  /** Custo por peça = totalBatchCost / batchQty */
  @Prop({ type: Number, default: 0 })
  costPerUnit: number;

  /** Preço de venda sugerido por peça */
  @Prop({ type: Number, default: 0 })
  suggestedPrice: number;

  /** Margem desejada para cálculo do preço sugerido (%) */
  @Prop({ type: Number, default: 60 })
  targetMarginPercent: number;

  /** Observações */
  @Prop({ trim: true })
  notes?: string;

  /** Data prevista de conclusão */
  @Prop({ type: Date })
  dueDate?: Date;
}

export const ProductionBatchSchema = SchemaFactory.createForClass(ProductionBatch);
ProductionBatchSchema.index({ status: 1 });
ProductionBatchSchema.index({ createdAt: -1 });
