import { ExecutionContext } from '@nestjs/common';
import * as common from '@nestjs/common';
import type { Request } from 'express';

export const LocationId = common.createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: { locationId?: string } }>();
    return req.user?.locationId;
  },
);
