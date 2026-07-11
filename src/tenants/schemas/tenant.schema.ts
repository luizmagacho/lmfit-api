import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/* ------------------------------------------------------------------ */
/*  Plan enum                                                         */
/* ------------------------------------------------------------------ */

export type TenantPlan = 'free' | 'basic' | 'pro' | 'enterprise';

export const TENANT_PLAN_VALUES = [
  'free',
  'basic',
  'pro',
  'enterprise',
] as const satisfies readonly TenantPlan[];

/* ------------------------------------------------------------------ */
/*  Embedded sub-schemas                                              */
/* ------------------------------------------------------------------ */

export class Branding {
  @Prop() logoUrl?: string;
  @Prop() faviconUrl?: string;
  @Prop({ default: '#7c3aed' }) primaryColor: string;
  @Prop({ default: '#06b6d4' }) secondaryColor: string;
  @Prop({ default: false }) darkMode: boolean;
}

export class TenantLimits {
  @Prop({ default: -1 }) maxProducts: number;
  @Prop({ default: 1 }) maxUsers: number;
}

/** Fidelidade/cashback: pontos ganhos por real gasto, resgatáveis em crédito de loja. */
export class LoyaltyConfig {
  @Prop({ default: false }) enabled: boolean;
  @Prop({ default: 1 }) pointsPerBRL: number;
  @Prop({ default: 0.01 }) redeemValuePerPoint: number;
}

export type FiscalRegime = 'simples_nacional' | 'lucro_presumido' | 'lucro_real';
export type FiscalAmbiente = 'homologacao' | 'producao';

/** Fiscal identity + emitter credentials used to emit NF-e/NFC-e for this tenant. */
export class FiscalConfig {
  @Prop({ trim: true }) cnpj?: string;
  @Prop({ trim: true }) inscricaoEstadual?: string;
  @Prop({ type: String, enum: ['simples_nacional', 'lucro_presumido', 'lucro_real'] })
  regimeTributario?: FiscalRegime;
  @Prop({ type: String, enum: ['homologacao', 'producao'], default: 'homologacao' })
  ambiente: FiscalAmbiente;
  /** Token do emitente cadastrado no painel Focus NFe (substitui a Nuvem Fiscal, desativada em 31/07/2026). */
  @Prop({ trim: true }) focusNfeToken?: string;
  /** @deprecated Nuvem Fiscal foi descontinuada — mantido só pra não perder dados de tenants antigos. */
  @Prop({ trim: true }) nuvemFiscalClientId?: string;
  /** @deprecated ver `nuvemFiscalClientId`. */
  @Prop({ trim: true }) nuvemFiscalClientSecret?: string;
}

/* ------------------------------------------------------------------ */
/*  Main schema                                                       */
/* ------------------------------------------------------------------ */

export type TenantDocument = HydratedDocument<Tenant>;

@Schema({ timestamps: true })
export class Tenant {
  @Prop({ required: true, unique: true, lowercase: true, trim: true, index: true })
  slug: string;

  @Prop({ required: true })
  name: string;

  @Prop({ default: true })
  active: boolean;

  @Prop({ type: Branding, default: () => ({}) })
  branding: Branding;

  @Prop()
  whatsappNumber?: string;

  @Prop({ type: String, enum: TENANT_PLAN_VALUES, default: 'free' })
  plan: TenantPlan;

  @Prop({ type: [String], default: [] })
  featuresOverride: string[];

  @Prop({ type: TenantLimits, default: () => ({}) })
  limits: TenantLimits;

  @Prop({ type: FiscalConfig, default: () => ({}) })
  fiscal: FiscalConfig;

  @Prop({ type: LoyaltyConfig, default: () => ({}) })
  loyalty: LoyaltyConfig;

  @Prop({ trim: true })
  geminiApiKey?: string;

  @Prop({ trim: true })
  metaAppSecret?: string;

  @Prop({ trim: true })
  metaWhatsappVerifyToken?: string;

  @Prop({ trim: true })
  metaWhatsappPhoneNumberId?: string;

  @Prop({ trim: true })
  metaWhatsappAccessToken?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  ownerUserId?: Types.ObjectId;

  @Prop({ trim: true })
  infinitePayTag?: string;

  @Prop({ trim: true })
  infinitePayApiKey?: string;

  /* Stripe Fields */
  @Prop({ trim: true })
  stripeCustomerId?: string;

  @Prop({ trim: true })
  stripeSubscriptionId?: string;

  @Prop({ trim: true })
  stripeSubscriptionStatus?: string;

  @Prop({ type: Number })
  stripeSubscriptionEnd?: number;
}

export const TenantSchema = SchemaFactory.createForClass(Tenant);
TenantSchema.index({ slug: 1 }, { unique: true });
