import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rastreia o rate-limit por tenant em vez de por IP. Evita que múltiplas lojas/PDVs
 * atrás do mesmo NAT estourem o limite umas das outras, e evita que um tenant
 * abusivo escape do limite trocando de IP. Cai pro IP quando não há tenant
 * resolvido (rotas fora do TenantMiddleware, ex.: health check).
 */
@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.tenantId ?? req.user?.tenantId ?? req.ip;
  }
}
