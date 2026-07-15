import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FailedWebhookDocument = HydratedDocument<FailedWebhook>;

/**
 * Outbound payment webhooks that exhausted all delivery retries.
 * Kept so a failed delivery is investigable instead of silently lost —
 * see PaymentWebhookDispatcherService.
 */
@Schema({ timestamps: true })
export class FailedWebhook {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', index: true })
  tenantId?: Types.ObjectId;

  @Prop({ required: true, index: true })
  event: string;

  @Prop({ type: Object, required: true })
  payload: Record<string, unknown>;

  @Prop({ required: true })
  url: string;

  @Prop({ required: true })
  lastError: string;

  @Prop({ required: true, default: 0 })
  attempts: number;

  @Prop({ default: false, index: true })
  resolved: boolean;
}

export const FailedWebhookSchema = SchemaFactory.createForClass(FailedWebhook);
