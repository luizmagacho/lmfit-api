import { ExecutionContext } from '@nestjs/common';
import * as common from '@nestjs/common';
import type { Request } from 'express';

/** Features unlocked for the resolved tenant's plan (set by TenantMiddleware). */
export const TenantFeatures = common.createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string[] => {
    const req = ctx.switchToHttp().getRequest<Request & { tenantFeatures?: string[] }>();
    return req.tenantFeatures ?? [];
  },
);
