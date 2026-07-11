import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { tap } from 'rxjs/operators';
import type { JwtUserPayload } from '../auth/jwt-user.payload';
import { AUDIT_ACTION_KEY } from './audited.decorator';
import { AuditService } from './audit.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const action = this.reflector.get<string | undefined>(AUDIT_ACTION_KEY, context.getHandler());
    if (!action) return next.handle();

    const req = context
      .switchToHttp()
      .getRequest<Request & { tenantId?: string; user?: JwtUserPayload }>();
    const tenantId = req.tenantId ?? req.user?.tenantId;
    const userId = req.user?.sub;
    const params = req.params as Record<string, string> | undefined;
    const resourceId = params?.id ?? params?.orderId ?? params?.token ?? params?.variantId;

    return next.handle().pipe(
      tap(() => {
        this.audit.record({
          tenantId,
          userId,
          action,
          resourceId,
          metadata: { method: req.method, path: req.originalUrl },
        });
      }),
    );
  }
}
