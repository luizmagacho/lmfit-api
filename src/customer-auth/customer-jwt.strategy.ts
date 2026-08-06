import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { CustomerJwtPayload } from './customer-jwt.payload';

@Injectable()
export class CustomerJwtStrategy extends PassportStrategy(Strategy, 'jwt-customer') {
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_CUSTOMER_ACCESS_SECRET');
    if (!secret) {
      throw new Error('JWT_CUSTOMER_ACCESS_SECRET is required');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  validate(payload: CustomerJwtPayload): CustomerJwtPayload {
    if (!payload?.sub || !payload.tenantId) {
      throw new UnauthorizedException();
    }
    return { sub: payload.sub, tenantId: payload.tenantId };
  }
}
