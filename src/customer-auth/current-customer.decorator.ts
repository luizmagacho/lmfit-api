import { ExecutionContext } from '@nestjs/common';
import * as common from '@nestjs/common';
import type { Request } from 'express';
import type { CustomerJwtPayload } from './customer-jwt.payload';

export const CurrentCustomer = common.createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CustomerJwtPayload => {
    const req = ctx.switchToHttp().getRequest<Request & { user: CustomerJwtPayload }>();
    return req.user;
  },
);
