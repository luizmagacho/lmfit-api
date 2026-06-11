import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Feature } from '../enums/feature.enum';
import { REQUIRED_FEATURES_KEY } from '../decorators/require-feature.decorator';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Feature[]>(REQUIRED_FEATURES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length) return true;

    const req = context.switchToHttp().getRequest<Request & { tenantFeatures?: string[] }>();
    const tenantFeatures = req.tenantFeatures ?? [];

    const hasAll = required.every((f) => tenantFeatures.includes(f));
    if (!hasAll) {
      throw new ForbiddenException(
        'Este recurso requer um plano superior. Entre em contato para upgrade.',
      );
    }

    return true;
  }
}
