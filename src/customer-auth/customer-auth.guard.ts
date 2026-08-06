import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class CustomerAuthGuard extends AuthGuard('jwt-customer') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isValid = await super.canActivate(context);
    if (!isValid) return false;

    const request = context.switchToHttp().getRequest();
    const customer = request.user;
    const resolvedTenantId = request.tenantId;

    if (customer && resolvedTenantId && customer.tenantId !== resolvedTenantId) {
      throw new UnauthorizedException('Este token de acesso pertence a outra loja.');
    }

    return true;
  }
}
