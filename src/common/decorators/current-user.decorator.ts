import { ExecutionContext } from '@nestjs/common';
import * as common from '@nestjs/common';
import type { Request } from 'express';
import type { JwtUserPayload } from '../../auth/jwt-user.payload';

export const CurrentUser = common.createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUserPayload => {
    const req = ctx.switchToHttp().getRequest<Request & { user: JwtUserPayload }>();
    return req.user;
  },
);
