import {
  BadRequestException,
  Injectable,
  NestMiddleware,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { TenantsService } from '../../tenants/tenants.service';

/** Paths that never require a resolved tenant. */
const EXEMPT_PREFIXES = [
  '/health',
  '/public/tenants/', // GET /public/tenants/:slug
  '/webhooks/',
];

/** Paths that must be matched exactly (no prefix match). */
const EXEMPT_EXACT = [
  '/public/tenants', // GET /public/tenants — lista todas as lojas
];

function isExempt(path: string): boolean {
  if (EXEMPT_EXACT.includes(path)) return true;
  return EXEMPT_PREFIXES.some((p) => path.startsWith(p));
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenantsService: TenantsService) {}

  async use(
    req: Request & {
      tenantId?: string;
      tenantSlug?: string;
      tenantPlan?: string;
      tenantFeatures?: string[];
      user?: { sub?: string; tenantId?: string };
    },
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    const path = req.baseUrl || req.path;

    if (isExempt(path)) {
      return next();
    }

    const slug = req.headers['x-tenant-slug'] as string | undefined;

    // Resolve tenant by slug header
    if (slug) {
      const tenant = await this.tenantsService.findBySlug(slug);

      if (!tenant || !tenant.active) {
        throw new BadRequestException('Tenant not found or inactive');
      }

      req.tenantId = tenant._id.toString();
      req.tenantSlug = tenant.slug;
      req.tenantPlan = tenant.plan;
      req.tenantFeatures = this.tenantsService.resolveFeatures(tenant);

      return next();
    }

    // For /public/* paths (other than /public/tenants/) the slug header is mandatory
    if (path.startsWith('/public/')) {
      throw new BadRequestException('Tenant not found or inactive');
    }

    // For authenticated routes, fall back to JWT tenantId
    const jwtTenantId = req.user?.tenantId;
    if (jwtTenantId) {
      const tenant = await this.tenantsService.findById(jwtTenantId);

      if (!tenant || !tenant.active) {
        throw new BadRequestException('Tenant not found or inactive');
      }

      req.tenantId = tenant._id.toString();
      req.tenantSlug = tenant.slug;
      req.tenantPlan = tenant.plan;
      req.tenantFeatures = this.tenantsService.resolveFeatures(tenant);

      return next();
    }

    // No tenant could be resolved — this will be caught later by guards
    // for routes that actually require auth
    next();
  }
}
