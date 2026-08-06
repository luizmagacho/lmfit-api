import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CounterDocument = HydratedDocument<Counter>;

/** Atomic per-tenant named sequence (e.g. `name: 'order'`) — the one source of a
 *  monotonically increasing number, replacing `countDocuments()+1` races. */
@Schema({ timestamps: true })
export class Counter {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: Number, required: true, default: 0 })
  seq: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);
CounterSchema.index({ tenantId: 1, name: 1 }, { unique: true });
