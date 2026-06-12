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
}

export const TenantSchema = SchemaFactory.createForClass(Tenant);
TenantSchema.index({ slug: 1 }, { unique: true });
