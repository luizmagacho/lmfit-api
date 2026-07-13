import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { skipFromPage } from '../common/dto/pagination-query.dto';
import type { CreateTenantDto } from './dto/create-tenant.dto';
import type { UpdateBrandingDto } from './dto/update-branding.dto';
import type { UpdateFiscalConfigDto } from './dto/update-fiscal-config.dto';
import type { UpdateLoyaltyConfigDto } from './dto/update-loyalty-config.dto';
import type { UpdateTenantDto } from './dto/update-tenant.dto';
import { Tenant, type TenantDocument, type TenantPlan } from './schemas/tenant.schema';
import { TenantRequest, type TenantRequestDocument } from './schemas/tenant-request.schema';
import type { CreateTenantRequestDto } from './dto/create-tenant-request.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { escapeRegex } from '../common/utils/text-search.util';

/* ------------------------------------------------------------------ */
/*  Feature flags per plan                                            */
/* ------------------------------------------------------------------ */

const PLAN_FEATURES: Record<TenantPlan, string[]> = {
  free: ['catalog', 'inventory'],
  basic: [
    'catalog', 'inventory',
    'customers', 'orders', 'suppliers', 'reports_basic', 'export',
  ],
  pro: [
    'catalog', 'inventory',
    'customers', 'orders', 'suppliers', 'reports_basic', 'export',
    'wholesale', 'production', 'chatbot', 'checkout',
  ],
  enterprise: [
    'catalog', 'inventory',
    'customers', 'orders', 'suppliers', 'reports_basic', 'export',
    'wholesale', 'production', 'chatbot', 'checkout',
    'financial', 'invoices', 'reports_advanced', 'api_access',
  ],
};

const PLAN_LIMITS: Record<TenantPlan, { maxProducts: number; maxUsers: number }> = {
  free: { maxProducts: 20, maxUsers: 1 },
  basic: { maxProducts: -1, maxUsers: 3 },
  pro: { maxProducts: -1, maxUsers: 10 },
  enterprise: { maxProducts: -1, maxUsers: -1 },
};

/* ------------------------------------------------------------------ */
/*  Cache entry type                                                  */
/* ------------------------------------------------------------------ */

interface CacheEntry {
  tenant: TenantDocument;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/* ------------------------------------------------------------------ */
/*  Service                                                           */
/* ------------------------------------------------------------------ */

@Injectable()
export class TenantsService {
  private slugCache = new Map<string, CacheEntry>();

  constructor(
    @InjectModel(Tenant.name) private readonly tenantModel: Model<Tenant>,
    @InjectModel(TenantRequest.name) private readonly tenantRequestModel: Model<TenantRequest>,
    private readonly notifications: NotificationsService,
  ) {}

  /* ----- slug-based lookup with cache ----- */

  async findBySlug(slug: string): Promise<TenantDocument | null> {
    const now = Date.now();
    const cached = this.slugCache.get(slug);
    if (cached && cached.expiresAt > now) {
      return cached.tenant;
    }

    const tenant = await this.tenantModel
      .findOne({ slug })
      .exec();

    if (tenant) {
      this.slugCache.set(slug, { tenant, expiresAt: now + CACHE_TTL_MS });
    } else {
      this.slugCache.delete(slug);
    }
    return tenant;
  }

  /* ----- by ID ----- */

  async findById(id: string): Promise<TenantDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const tenant = await this.tenantModel.findById(id).exec();
    if (!tenant) throw new NotFoundException();
    return tenant;
  }

  /* ----- feature resolution ----- */

  resolveFeatures(tenant: TenantDocument): string[] {
    const planFeatures = PLAN_FEATURES[tenant.plan] ?? PLAN_FEATURES.free;
    const overrides = tenant.featuresOverride ?? [];
    return [...new Set([...planFeatures, ...overrides])];
  }

  hasFeature(tenant: TenantDocument, feature: string): boolean {
    return this.resolveFeatures(tenant).includes(feature);
  }

  /* ----- create ----- */

  async create(dto: CreateTenantDto): Promise<TenantDocument> {
    const doc = await this.tenantModel.create({
      slug: dto.slug,
      name: dto.name,
      plan: dto.plan ?? 'free',
      whatsappNumber: dto.whatsappNumber,
      branding: dto.branding ?? {},
      limits: dto.limits ?? {},
      featuresOverride: dto.featuresOverride ?? [],
    });
    return doc;
  }

  /* ----- update ----- */

  async update(id: string, dto: UpdateTenantDto): Promise<TenantDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();

    const doc = await this.tenantModel
      .findByIdAndUpdate(id, { $set: dto }, { new: true })
      .exec();
    if (!doc) throw new NotFoundException();

    // invalidate cache
    this.slugCache.delete(doc.slug);
    return doc;
  }

  /* ----- update branding only ----- */

  async updateBranding(id: string, dto: UpdateBrandingDto): Promise<TenantDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();

    const setFields: Record<string, unknown> = {};
    if (dto.logoUrl !== undefined) setFields['branding.logoUrl'] = dto.logoUrl;
    if (dto.faviconUrl !== undefined) setFields['branding.faviconUrl'] = dto.faviconUrl;
    if (dto.primaryColor !== undefined) setFields['branding.primaryColor'] = dto.primaryColor;
    if (dto.secondaryColor !== undefined) setFields['branding.secondaryColor'] = dto.secondaryColor;
    if (dto.darkMode !== undefined) setFields['branding.darkMode'] = dto.darkMode;
    if (dto.infinitePayTag !== undefined) setFields['infinitePayTag'] = dto.infinitePayTag;
    if (dto.infinitePayApiKey !== undefined) setFields['infinitePayApiKey'] = dto.infinitePayApiKey;
    if (dto.geminiApiKey !== undefined) setFields['geminiApiKey'] = dto.geminiApiKey;
    if (dto.metaAppSecret !== undefined) setFields['metaAppSecret'] = dto.metaAppSecret;
    if (dto.metaWhatsappVerifyToken !== undefined) setFields['metaWhatsappVerifyToken'] = dto.metaWhatsappVerifyToken;
    if (dto.metaWhatsappPhoneNumberId !== undefined) setFields['metaWhatsappPhoneNumberId'] = dto.metaWhatsappPhoneNumberId;
    if (dto.metaWhatsappAccessToken !== undefined) setFields['metaWhatsappAccessToken'] = dto.metaWhatsappAccessToken;

    const doc = await this.tenantModel
      .findByIdAndUpdate(id, { $set: setFields }, { new: true })
      .exec();
    if (!doc) throw new NotFoundException();

    // invalidate cache
    this.slugCache.delete(doc.slug);
    return doc;
  }

  /* ----- update fiscal config only ----- */

  async updateFiscalConfig(id: string, dto: UpdateFiscalConfigDto): Promise<TenantDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();

    const setFields: Record<string, unknown> = {};
    if (dto.cnpj !== undefined) setFields['fiscal.cnpj'] = dto.cnpj;
    if (dto.inscricaoEstadual !== undefined) setFields['fiscal.inscricaoEstadual'] = dto.inscricaoEstadual;
    if (dto.regimeTributario !== undefined) setFields['fiscal.regimeTributario'] = dto.regimeTributario;
    if (dto.ambiente !== undefined) setFields['fiscal.ambiente'] = dto.ambiente;
    if (dto.focusNfeToken !== undefined) setFields['fiscal.focusNfeToken'] = dto.focusNfeToken;
    if (dto.nuvemFiscalClientId !== undefined) setFields['fiscal.nuvemFiscalClientId'] = dto.nuvemFiscalClientId;
    if (dto.nuvemFiscalClientSecret !== undefined) setFields['fiscal.nuvemFiscalClientSecret'] = dto.nuvemFiscalClientSecret;

    const doc = await this.tenantModel
      .findByIdAndUpdate(id, { $set: setFields }, { new: true })
      .exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }

  /* ----- update loyalty config only ----- */

  async updateLoyaltyConfig(id: string, dto: UpdateLoyaltyConfigDto): Promise<TenantDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();

    const setFields: Record<string, unknown> = {};
    if (dto.enabled !== undefined) setFields['loyalty.enabled'] = dto.enabled;
    if (dto.pointsPerBRL !== undefined) setFields['loyalty.pointsPerBRL'] = dto.pointsPerBRL;
    if (dto.redeemValuePerPoint !== undefined) setFields['loyalty.redeemValuePerPoint'] = dto.redeemValuePerPoint;

    const doc = await this.tenantModel
      .findByIdAndUpdate(id, { $set: setFields }, { new: true })
      .exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }

  /* ----- paginated list ----- */

  async list(page: number, limit: number, search?: string) {
    const skip = skipFromPage(page, limit);

    const safeSearch = search ? escapeRegex(search) : undefined;
    const q = safeSearch
      ? {
          $or: [
            { name: new RegExp(safeSearch, 'i') },
            { slug: new RegExp(safeSearch, 'i') },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      this.tenantModel
        .find(q)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.tenantModel.countDocuments(q).exec(),
    ]);

    return { items, total, page, limit };
  }

  /* ----- public branding (no auth) ----- */

  resolveLimits(tenant: any) {
    const plan = tenant.plan || 'free';
    const defaults = (PLAN_LIMITS as any)[plan] || PLAN_LIMITS.free;
    const maxProducts = tenant.limits?.maxProducts !== undefined && tenant.limits?.maxProducts !== -1
      ? tenant.limits.maxProducts
      : defaults.maxProducts;

    const planMaxUsers = defaults.maxUsers;
    const dbMaxUsers = tenant.limits?.maxUsers ?? 1;
    const maxUsers = planMaxUsers === -1 || dbMaxUsers === -1
      ? -1
      : Math.max(dbMaxUsers, planMaxUsers);

    return {
      maxProducts,
      maxUsers,
    };
  }

  async getPublicBranding(slug: string) {
    const tenant = await this.findBySlug(slug);
    if (!tenant) throw new NotFoundException();

    return {
      slug: tenant.slug,
      name: tenant.name,
      branding: tenant.branding,
      whatsappNumber: tenant.whatsappNumber,
      infinitePayTag: tenant.infinitePayTag,
      plan: tenant.plan,
      limits: this.resolveLimits(tenant),
    };
  }

  async listPublicActive() {
    const items = await this.tenantModel
      .find({ active: { $ne: false } })
      .sort({ name: 1 })
      .lean()
      .exec();

    return items.map(tenant => ({
      slug: tenant.slug,
      name: tenant.name,
      branding: tenant.branding,
      whatsappNumber: tenant.whatsappNumber,
    }));
  }

  async createTenantRequest(dto: CreateTenantRequestDto): Promise<TenantRequestDocument> {
    const request = await this.tenantRequestModel.create({
      storeName: dto.storeName,
      ownerName: dto.ownerName,
      ownerEmail: dto.ownerEmail,
      ownerPhone: dto.ownerPhone,
      desiredDomain: dto.desiredDomain,
      status: 'pending',
    });

    const ownerSubject = 'Sua solicitação de loja no Kivoni foi recebida!';
    const ownerText = `Olá ${dto.ownerName},\n\nRecebemos a sua solicitação para a criação da loja "${dto.storeName}" com o domínio desejado "${dto.desiredDomain}.kivoni.com.br".\n\nNossa equipe está trabalhando no seu setup e em até 24 horas a sua loja online estará online!\n\nSe tiver alguma dúvida, entre em contato conosco.\n\nAtenciosamente,\nEquipe Kivoni`;
    const ownerHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #7c3aed; margin-top: 0;">Olá ${dto.ownerName}!</h2>
        <p>Recebemos a sua solicitação para a criação da loja <strong>${dto.storeName}</strong> com o domínio desejado <strong>${dto.desiredDomain}.kivoni.com.br</strong>.</p>
        <div style="background-color: #f8fafc; border-left: 4px solid #7c3aed; padding: 15px; margin: 20px 0;">
          <p style="margin: 0; font-weight: bold; color: #0f172a;">Sua loja online estará ativa em até 24 horas!</p>
          <p style="margin: 5px 0 0 0; font-size: 14px; color: #475569;">Nossa equipe já está realizando a configuração manual do seu ambiente.</p>
        </div>
        <p>Entraremos em contato assim que estiver tudo pronto.</p>
        <p style="margin-top: 30px; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 15px;">Atenciosamente,<br><strong>Equipe Kivoni</strong></p>
      </div>
    `;

    this.notifications.sendEmail(dto.ownerEmail, ownerSubject, ownerText, ownerHtml)
      .catch(err => this.notifications.logStaffAlert(`Erro ao enviar email de confirmação para o responsável: ${err.message}`));

    const staffSubject = `[NOVA LOJA] Nova solicitação de setup pendente: ${dto.storeName}`;
    const staffText = `Uma nova solicitação de loja foi criada e necessita de setup manual no sistema.\n\n` +
      `Detalhes:\n` +
      `- Loja: ${dto.storeName}\n` +
      `- Responsável: ${dto.ownerName}\n` +
      `- E-mail: ${dto.ownerEmail}\n` +
      `- Celular/WhatsApp: ${dto.ownerPhone}\n` +
      `- Domínio desejado: ${dto.desiredDomain}.kivoni.com.br\n\n` +
      `Por favor, realize a criação e configuração desta loja no banco de dados e avise o cliente.`;

    const staffHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0;">
        <h2 style="color: #dc2626; margin-top: 0;">Nova Solicitação de Setup Manual</h2>
        <p>Uma nova loja foi solicitada e precisa ser configurada no banco de dados:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; font-weight: bold;">Loja/Empresa:</td><td style="padding: 8px 0;">${dto.storeName}</td></tr>
          <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; font-weight: bold;">Responsável:</td><td style="padding: 8px 0;">${dto.ownerName}</td></tr>
          <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; font-weight: bold;">E-mail:</td><td style="padding: 8px 0;">${dto.ownerEmail}</td></tr>
          <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; font-weight: bold;">Telefone/WhatsApp:</td><td style="padding: 8px 0;">${dto.ownerPhone}</td></tr>
          <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; font-weight: bold;">Domínio Desejado:</td><td style="padding: 8px 0; font-weight: bold; color: #2563eb;">${dto.desiredDomain}.kivoni.com.br</td></tr>
        </table>
        <p>Acesse o MongoDB para cadastrar o Tenant e o usuário administrador correspondente, e responda o cliente em seguida.</p>
      </div>
    `;

    this.notifications.sendStaffEmail(staffSubject, staffText)
      .catch(err => this.notifications.logStaffAlert(`Erro ao alertar a equipe sobre nova loja: ${err.message}`));

    return request;
  }
}
