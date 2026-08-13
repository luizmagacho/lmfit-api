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

/** Endereço de origem da loja (Loop 27) — necessário como ponto de partida de qualquer cotação real
 *  de frete (toda API de transportadora exige origem + destino). Mesmo shape de
 *  `customers/schemas/address.schema.ts`, sem `label`/`_id` (é um único endereço, não uma lista). */
export class ShippingOriginAddress {
  @Prop({ trim: true }) cep?: string;
  @Prop({ trim: true }) logradouro?: string;
  @Prop({ trim: true }) numero?: string;
  @Prop({ trim: true }) complemento?: string;
  @Prop({ trim: true }) bairro?: string;
  @Prop({ trim: true }) cidade?: string;
  @Prop({ trim: true }) uf?: string;
}

export type ShippingCarrierAmbiente = 'sandbox' | 'producao';

/** Credenciais da Melhor Envio (Loop 27) — token com escopo só de "Cotação de fretes" (não precisa
 *  do fluxo OAuth completo, ver adapter). `token` é guardado criptografado (mesmo padrão de
 *  `AnalyticsConfig.metaConversionsApiToken`, `EncryptionService`, Loop 18) — nunca em texto puro. */
export class MelhorEnvioConfig {
  @Prop({ trim: true }) token?: string;
  @Prop({ type: String, enum: ['sandbox', 'producao'], default: 'sandbox' })
  ambiente: ShippingCarrierAmbiente;
}

/** Frete v1 por método (Loop 3): taxa fixa por método + isenção acima de um valor de subtotal.
 *  `pickup` nunca cobra, independente de config. Cálculo real acontece sempre no servidor —
 *  o valor nunca é aceito vindo do cliente (ver order-drafts.service.ts `computeShippingCost`).
 *  Loop 27 acrescenta `originAddress`/`melhorEnvio`: sem token configurado, `ShippingQuoteService`
 *  cai automaticamente nas 3 taxas fixas abaixo — nenhum campo aqui muda de comportamento sozinho. */
export class ShippingConfig {
  @Prop({ trim: true, default: 'Retirada em Loja' }) pickupLabel: string;
  @Prop({ default: 19.9, min: 0 }) standardFee: number;
  @Prop({ default: 39.9, min: 0 }) expressFee: number;
  /** Subtotal (produtos, antes do desconto Pix) a partir do qual standard/express ficam grátis.
   *  `undefined`/0 = sem isenção. */
  @Prop({ min: 0 }) freeAboveTotal?: number;
  @Prop({ type: ShippingOriginAddress }) originAddress?: ShippingOriginAddress;
  @Prop({ type: MelhorEnvioConfig }) melhorEnvio?: MelhorEnvioConfig;
}

/** Camada de marca da loja pública v1 (Loop 4): estilo visual + avisos + liga/desliga.
 *  `themePreset` indexa uma tabela de tokens fixa no código do web (não é DB-editável) — ver
 *  STOREFRONT-V2.md §2.10 / storefrontPresets.ts. */
/** Textos das páginas institucionais (Loop 4 continuação) — CMS-lite: texto puro, sem editor rico. */
export class StorefrontPages {
  @Prop({ trim: true }) quemSomos?: string;
  @Prop({ trim: true }) comoComprar?: string;
  @Prop({ trim: true }) guiaMedidas?: string;
  @Prop({ trim: true }) contato?: string;
}

/** Um lookbook "compre o look": foto + variações selecionadas, sem desconto de combo nesta v1. */
export class StorefrontLookbook {
  @Prop({ trim: true }) imageUrl: string;
  @Prop({ trim: true }) title: string;
  @Prop({ type: [String], default: [] }) variantIds: string[];
}

/** Janela de troca/devolução (Loop 8) — validada no servidor em `ReturnsService`, não só na UI. */
export class ReturnPolicyConfig {
  @Prop({ default: 30, min: 0 }) windowDays: number;
  @Prop({ trim: true }) policyText?: string;
}

/** Um slide do carrossel de banners da home — imagem + link opcional pra um produto do catálogo +
 *  título/subtítulo/CTA opcionais (cada slide pode ter os seus, ou nenhum — a imagem sozinha já
 *  basta se a arte já carrega a mensagem). Substitui o antigo `heroLinkedProductSlug` (1 link só)
 *  — cada slide agora tem o seu próprio destino e o seu próprio texto. */
export class HeroBannerSlide {
  @Prop({ trim: true, required: true }) imageUrl: string;
  @Prop({ trim: true }) linkedProductSlug?: string;
  @Prop({ trim: true }) title?: string;
  @Prop({ trim: true }) subtitle?: string;
  @Prop({ trim: true }) ctaLabel?: string;
}

export class StorefrontConfig {
  @Prop({ default: true }) enabled: boolean;
  @Prop({
    type: String,
    // Loop 12 — 'luxo' e 'streetwear' adicionados (aditivo). IDs antigos NUNCA são renomeados:
    // tenants têm valores salvos; rótulos exibidos mudam só no front (storefrontPresets.ts).
    enum: ['essencial', 'editorial', 'performance', 'luxo', 'boutique', 'vibrante', 'studio', 'streetwear', 'impacto', 'monocromo'],
    default: 'essencial',
  })
  themePreset: string;
  @Prop({ type: [String], default: [] }) announcements: string[];

  // --- Home editorial em /catalogo (Loop 4 continuação) ---
  @Prop({ trim: true }) heroTitle?: string;
  @Prop({ trim: true }) heroSubtitle?: string;
  @Prop({ trim: true }) heroImageUrl?: string;
  /** Loop 4d — 2+ imagens vira carrossel automático no hero (qualquer preset); 0-1 mantém o
   *  comportamento de foto única de sempre via `heroImageUrl`. */
  @Prop({ type: [String], default: [] }) heroImages?: string[];
  @Prop({ trim: true }) heroCtaLabel?: string;
  /** Carrossel de banners promocionais menores/retangulares (distinto do hero estilizado por
   *  preset acima) — cada slide tem sua própria imagem e pode linkar pra um produto diferente.
   *  Quando configurado, `HeroBanner.tsx` renderiza este carrossel EM VEZ DO hero de
   *  título/imagem única (os dois modos são mutuamente exclusivos, não empilhados). */
  @Prop({ type: [HeroBannerSlide], default: [] }) heroBanners?: HeroBannerSlide[];
  @Prop({ default: false }) showTrustBar: boolean;
  /** Código de uma promoção já cadastrada (promotions module) — só exibição; a validação real do
   *  cupom continua acontecendo no checkout, igual antes. */
  @Prop({ trim: true, uppercase: true }) couponBannerCode?: string;
  @Prop({ type: StorefrontPages, default: () => ({}) }) pages: StorefrontPages;
  @Prop({ type: StorefrontLookbook }) lookbook?: StorefrontLookbook;
  @Prop({ type: ReturnPolicyConfig, default: () => ({}) }) returnPolicy: ReturnPolicyConfig;

  // --- SEO (Loop 10 v2) — sobrescreve o título/descrição padrão gerado a partir do nome do tenant ---
  @Prop({ trim: true, maxlength: 70 }) metaTitle?: string;
  @Prop({ trim: true, maxlength: 160 }) metaDescription?: string;
}

/** Regras de exibição de preço na loja pública (Loop 2 — não afeta o preço real cobrado por si só;
 *  o desconto Pix só é aplicado quando o comprador escolhe pagar via Pix no checkout). */
export class PricingDisplayConfig {
  /** 0–100; 0 = sem desconto exibido/aplicado no Pix. */
  @Prop({ default: 0, min: 0, max: 100 }) pixDiscountPercent: number;
  /** 1–12; 1 = sem parcelamento exibido. */
  @Prop({ default: 1, min: 1, max: 12 }) maxInstallments: number;
}

/**
 * Pixels de conversão (Loop 15) — Meta + GA4 + TikTok juntos, por escolha explícita do usuário.
 * Os IDs de pixel disparam eventos client-side (gated por `CookieConsentBanner`); os tokens de
 * servidor (`metaConversionsApiToken`/`ga4ApiSecret`/`tiktokAccessToken`) são opcionais e só
 * habilitam o evento de compra server-side a partir do webhook real da InfinitePay — sem eles,
 * o pixel ainda funciona pra page-view/add-to-cart client-side, só perde a conversão de compra do
 * caminho de pagamento real (a maioria das vendas, já que o checkout redireciona pra fora do site).
 */
export class AnalyticsConfig {
  @Prop({ trim: true }) metaPixelId?: string;
  @Prop({ trim: true }) metaConversionsApiToken?: string;
  @Prop({ trim: true }) ga4MeasurementId?: string;
  @Prop({ trim: true }) ga4ApiSecret?: string;
  @Prop({ trim: true }) tiktokPixelId?: string;
  @Prop({ trim: true }) tiktokAccessToken?: string;
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

  @Prop({ type: PricingDisplayConfig, default: () => ({}) })
  pricingDisplay: PricingDisplayConfig;

  @Prop({ type: ShippingConfig, default: () => ({}) })
  shippingConfig: ShippingConfig;

  @Prop({ type: StorefrontConfig, default: () => ({}) })
  storefront: StorefrontConfig;

  @Prop({ type: AnalyticsConfig, default: () => ({}) })
  analytics: AnalyticsConfig;

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

  /** Loop 11-A — liga a IA (Groq via `LlmService`) pra responder automaticamente clientes que
   *  mandam mensagem pro WhatsApp da loja (números fora da allowlist de staff). Default desligado
   *  até o lojista configurar as credenciais Meta acima e ativar de propósito. */
  @Prop({ default: false })
  whatsappAiEnabled: boolean;

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
