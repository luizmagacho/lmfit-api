import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtUserPayload } from './jwt-user.payload';
import type { UserRole } from '../users/schemas/user.schema';
import { normalizeRoleForJwt } from '../users/user-role.utils';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_ACCESS_SECRET');
    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET is required');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  validate(payload: JwtUserPayload): JwtUserPayload {
    if (!payload?.sub || !payload.email || !payload.tenantId) {
      throw new UnauthorizedException();
    }
    const role = normalizeRoleForJwt(payload.role as UserRole);
    return { sub: payload.sub, email: payload.email, role, tenantId: payload.tenantId };
  }
}
