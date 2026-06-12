import { Controller, Post, Body, Req, Headers, UseGuards, UnauthorizedException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';

@Controller('billing')
@SkipSubscriptionCheck()
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('checkout-session')
  @UseGuards(JwtAuthGuard)
  async createCheckoutSession(
    @TenantId() tenantId: string,
    @Body('priceId') priceId: string,
    @Body('successUrl') successUrl: string,
    @Body('cancelUrl') cancelUrl: string,
  ) {
    return this.billingService.createCheckoutSession(tenantId, priceId, successUrl, cancelUrl);
  }

  @Post('portal-session')
  @UseGuards(JwtAuthGuard)
  async createPortalSession(
    @TenantId() tenantId: string,
    @Body('returnUrl') returnUrl: string,
  ) {
    return this.billingService.createPortalSession(tenantId, returnUrl);
  }

  @Post('webhook')
  async handleWebhook(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) throw new UnauthorizedException('Missing stripe-signature header');
    
    // We must pass the raw body buffer to stripe.webhooks.constructEvent
    // NestJS allows accessing the raw body if configured properly in main.ts
    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      throw new Error('Raw body is not available for Stripe webhook');
    }

    return this.billingService.handleWebhook(rawBody, signature);
  }
}
