import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Request } from 'express';
import { Observable } from 'rxjs';

/**
 * Tags every Sentry event captured during this request with tenant/user
 * context, so errors in a multi-tenant app can be filtered by store.
 */
@Injectable()
export class SentryContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<
      Request & { tenantId?: string; tenantSlug?: string; user?: { sub?: string } }
    >();
    const scope = Sentry.getCurrentScope();
    if (req.tenantId) scope.setTag('tenantId', req.tenantId);
    if (req.tenantSlug) scope.setTag('tenantSlug', req.tenantSlug);
    if (req.user?.sub) scope.setUser({ id: req.user.sub });
    return next.handle();
  }
}
