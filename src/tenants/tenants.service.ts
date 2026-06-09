import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { skipFromPage } from '../common/dto/pagination-query.dto';
import type { CreateTenantDto } from './dto/create-tenant.dto';
import type { UpdateBrandingDto } from './dto/update-branding.dto';
import type { UpdateTenantDto } from './dto/update-tenant.dto';
import { Tenant, type TenantDocument, type TenantPlan } from './schemas/tenant.schema';

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

    const doc = await this.tenantModel
      .findByIdAndUpdate(id, { $set: setFields }, { new: true })
      .exec();
    if (!doc) throw new NotFoundException();

    // invalidate cache
    this.slugCache.delete(doc.slug);
    return doc;
  }

  /* ----- paginated list ----- */

  async list(page: number, limit: number, search?: string) {
    const skip = skipFromPage(page, limit);

    const q = search
      ? {
          $or: [
            { name: new RegExp(search, 'i') },
            { slug: new RegExp(search, 'i') },
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

  async getPublicBranding(slug: string) {
    const tenant = await this.findBySlug(slug);
    if (!tenant) throw new NotFoundException();

    return {
      slug: tenant.slug,
      name: tenant.name,
      branding: tenant.branding,
      whatsappNumber: tenant.whatsappNumber,
      infinitePayTag: tenant.infinitePayTag,
    };
  }
}
