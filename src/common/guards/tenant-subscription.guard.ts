import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Request } from 'express';
import { IS_SKIP_SUBSCRIPTION_CHECK_KEY } from '../decorators/skip-subscription-check.decorator';
import { Tenant } from '../../tenants/schemas/tenant.schema';

@Injectable()
export class TenantSubscriptionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectModel(Tenant.name) private tenantModel: Model<Tenant>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    const isSkipCheck = this.reflector.getAllAndOverride<boolean>(IS_SKIP_SUBSCRIPTION_CHECK_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic || isSkipCheck) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    
    // We expect the JwtAuthGuard to have populated request.user
    // If not, maybe it's a route that doesn't require auth, but if it's not public, we should have a user.
    const user = (request as any).user;
    if (!user || !user.tenantId) {
      return true; // Let other guards handle lack of auth
    }

    const tenant = await this.tenantModel.findById(user.tenantId).lean();
    if (!tenant) {
      return true;
    }

    // Only block if they have a stripeSubscriptionStatus that explicitly means payment failed/canceled,
    // and they are not on the "free" plan (if a free plan has no status, it's allowed).
    const badStatuses = ['past_due', 'unpaid', 'canceled'];
    if (tenant.stripeSubscriptionStatus && badStatuses.includes(tenant.stripeSubscriptionStatus)) {
      // 402 Payment Required
      throw new HttpException('Subscription payment required', HttpStatus.PAYMENT_REQUIRED);
    }

    return true;
  }
}
