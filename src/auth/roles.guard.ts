import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from './roles.decorator';
import type { JwtUserPayload } from './jwt-user.payload';
import { roleSatisfies } from '../users/user-role.utils';
import type { UserRole } from '../users/schemas/user.schema';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const req = context.switchToHttp().getRequest<Request & { user: JwtUserPayload }>();
    const user = req.user;
    if (!user) throw new ForbiddenException();
    if (!roleSatisfies(user.role as UserRole, required)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
