import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isValid = await super.canActivate(context);
    if (!isValid) return false;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const resolvedTenantId = request.tenantId;

    if (user && resolvedTenantId && user.tenantId !== resolvedTenantId) {
      throw new UnauthorizedException('Este token de acesso pertence a outra loja.');
    }

    return true;
  }
}
