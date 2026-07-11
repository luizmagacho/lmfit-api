import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type IntegrationDocument = HydratedDocument<Integration>;

export type IntegrationPlatform =
  | 'bagy'
  | 'nuvemshop'
  | 'tray'
  | 'loja_integrada'
  | 'shopify'
  | 'mercadolivre'
  | 'shopee'
  | 'tiktok';
export type SyncStatus = 'success' | 'partial' | 'error';

@Schema({ _id: false })
export class IntegrationCredentials {
  @Prop() accessToken?: string;
  @Prop() apiKey?: string;
  @Prop() applicationKey?: string;
  @Prop() storeId?: string;
  @Prop() storeDomain?: string;
  /** TikTok Shop: refresh_token do OAuth (access_token expira em ~90 dias). */
  @Prop() refreshToken?: string;
  /** TikTok Shop: shop_cipher retornado junto com o access_token na autorização — obrigatório em toda chamada da Shop API. */
  @Prop() shopCipher?: string;
}

@Schema({ timestamps: true, collection: 'integrations' })
export class Integration {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: ['bagy', 'nuvemshop', 'tray', 'loja_integrada', 'shopify', 'mercadolivre', 'shopee'],
  })
  platform: IntegrationPlatform;

  @Prop({ required: true, trim: true })
  label: string;

  @Prop({ type: IntegrationCredentials, required: true })
  credentials: IntegrationCredentials;

  @Prop({ default: true })
  active: boolean;

  @Prop({ default: false })
  syncProducts: boolean;

  @Prop({ default: true })
  syncStock: boolean;

  @Prop({ default: false })
  syncOrders: boolean;

  @Prop({ type: Date })
  lastSyncAt?: Date;

  /** Marca até onde a importação de pedidos já avançou (pull incremental). */
  @Prop({ type: Date })
  lastOrderSyncAt?: Date;

  @Prop({ type: String, enum: ['success', 'partial', 'error'] })
  lastSyncStatus?: SyncStatus;

  @Prop()
  lastSyncError?: string;

  @Prop()
  webhookSecret?: string;
}

export const IntegrationSchema = SchemaFactory.createForClass(Integration);
IntegrationSchema.index({ tenantId: 1, platform: 1 });
