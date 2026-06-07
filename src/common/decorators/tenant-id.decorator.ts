import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const req = ctx.switchToHttp().getRequest<Request & { tenantId?: string; user?: { tenantId?: string } }>();
    return req.tenantId ?? req.user?.tenantId;
  },
);
