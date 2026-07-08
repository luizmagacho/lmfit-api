import { ExecutionContext } from '@nestjs/common';
import * as common from '@nestjs/common';
import type { Request } from 'express';

export const TenantId = common.createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const req = ctx.switchToHttp().getRequest<Request & { tenantId?: string; user?: { tenantId?: string } }>();
    return req.tenantId ?? req.user?.tenantId;
  },
);

