import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { Tenant } from '../tenants/schemas/tenant.schema';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private stripe: any;

  constructor(
    @InjectModel(Tenant.name) private tenantModel: Model<Tenant>,
  ) {
    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (stripeSecret) {
      this.stripe = new Stripe(stripeSecret, {
        apiVersion: '2025-02-24.acacia' as any,
      });
    } else {
      this.logger.warn('STRIPE_SECRET_KEY is not defined. Billing will not work properly.');
    }
  }

  async createCheckoutSession(tenantId: string, priceId: string, successUrl: string, cancelUrl: string) {
    if (!this.stripe) throw new InternalServerErrorException('Stripe not configured');

    const tenant = await this.tenantModel.findById(tenantId);
    if (!tenant) throw new NotFoundException('Tenant not found');

    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: tenant.id, // We'll use this in the webhook to map back to the tenant
      customer: tenant.stripeCustomerId || undefined, // use existing customer if available
    });

    return { url: session.url };
  }

  async createPortalSession(tenantId: string, returnUrl: string) {
    if (!this.stripe) throw new InternalServerErrorException('Stripe not configured');

    const tenant = await this.tenantModel.findById(tenantId);
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (!tenant.stripeCustomerId) throw new NotFoundException('Tenant has no Stripe customer ID');

    const session = await this.stripe.billingPortal.sessions.create({
      customer: tenant.stripeCustomerId,
      return_url: returnUrl,
    });

    return { url: session.url };
  }

  async handleWebhook(body: Buffer, signature: string) {
    if (!this.stripe) throw new InternalServerErrorException('Stripe not configured');
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      this.logger.error('Missing STRIPE_WEBHOOK_SECRET');
      throw new InternalServerErrorException('Missing webhook secret');
    }

    let event: any;

    try {
      event = this.stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      this.logger.error(`Webhook signature verification failed: ${(err as any).message}`);
      throw new Error(`Webhook Error: ${(err as any).message}`);
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutSessionCompleted(event.data.object as any);
          break;
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object as any);
          break;
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object as any);
          break;
        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event.data.object as any);
          break;
        default:
          this.logger.debug(`Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      this.logger.error(`Error processing webhook event ${event.type}:`, error);
    }

    return { received: true };
  }

  private getPlanNameFromPriceId(priceId: string): 'basic' | 'pro' | 'enterprise' | 'free' {
    const plans: Record<string, 'basic' | 'pro' | 'enterprise'> = {
      'price_1ThVkP2L6koEu6W2c5axNLhh': 'basic',
      'price_1ThVkQ2L6koEu6W2H6stMQf3': 'pro',
      'price_1ThVkQ2L6koEu6W2JUJIgZuB': 'enterprise',
      'price_1ThVle2L6koEu6W28ejtHUEs': 'basic', // Annual
      'price_1ThVle2L6koEu6W27xkRZ8d1': 'pro', // Annual
      'price_1ThVlf2L6koEu6W2IS23cjKw': 'enterprise', // Annual
      
      // New Price IDs
      'price_1ThXem2L6koEu6W2OzgMerg3': 'basic',       // Monthly
      'price_1ThXem2L6koEu6W2VG1cfVbZ': 'basic',       // Annual
      'price_1ThXen2L6koEu6W2F09NnzPD': 'pro',         // Monthly
      'price_1ThXen2L6koEu6W2kTEdw0Ed': 'pro',         // Annual
      'price_1ThXen2L6koEu6W29bCCgspZ': 'enterprise',  // Monthly
      'price_1ThXeo2L6koEu6W2PD1ODdFp': 'enterprise',  // Annual
    };
    return plans[priceId] || 'free';
  }

  private async handleCheckoutSessionCompleted(session: any) {
    if (!session.client_reference_id) return;
    const tenantId = session.client_reference_id;

    // Expand the subscription to get price and status
    const subscription = await this.stripe.subscriptions.retrieve(session.subscription as string);
    const priceId = subscription.items.data[0].price.id;

    await this.tenantModel.findByIdAndUpdate(tenantId, {
      stripeCustomerId: session.customer as string,
      stripeSubscriptionId: session.subscription as string,
      stripeSubscriptionStatus: subscription.status,
      stripeSubscriptionEnd: subscription.current_period_end,
      plan: this.getPlanNameFromPriceId(priceId),
    });

    this.logger.log(`Tenant ${tenantId} subscribed to plan ${priceId}`);
  }

  private async handleSubscriptionUpdated(subscription: any) {
    // Find the tenant by stripeSubscriptionId or stripeCustomerId
    const tenant = await this.tenantModel.findOne({ stripeCustomerId: subscription.customer as string });
    if (!tenant) return;

    const priceId = subscription.items.data[0].price.id;

    await this.tenantModel.findByIdAndUpdate(tenant.id, {
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus: subscription.status,
      stripeSubscriptionEnd: subscription.current_period_end,
      plan: subscription.status === 'active' || subscription.status === 'trialing' ? this.getPlanNameFromPriceId(priceId) : tenant.plan,
    });
    
    this.logger.log(`Tenant ${tenant.id} subscription updated to status: ${subscription.status}`);
  }

  private async handleSubscriptionDeleted(subscription: any) {
    const tenant = await this.tenantModel.findOne({ stripeSubscriptionId: subscription.id });
    if (!tenant) return;

    await this.tenantModel.findByIdAndUpdate(tenant.id, {
      stripeSubscriptionStatus: subscription.status, // canceled
      plan: 'free',
    });
    this.logger.log(`Tenant ${tenant.id} subscription canceled. Downgraded to free.`);
  }

  private async handleInvoicePaymentFailed(invoice: any) {
    const tenant = await this.tenantModel.findOne({ stripeCustomerId: invoice.customer as string });
    if (!tenant) return;

    // Usually the subscription status also becomes past_due, which will be caught by subscription.updated,
    // but just to be safe:
    if (invoice.subscription) {
      const sub = await this.stripe.subscriptions.retrieve(invoice.subscription as string);
      await this.tenantModel.findByIdAndUpdate(tenant.id, {
        stripeSubscriptionStatus: sub.status,
      });
    }
  }

  async getSubscriptionDetails(tenantId: string) {
    const tenant = await this.tenantModel.findById(tenantId).lean();
    if (!tenant) throw new NotFoundException('Tenant not found');

    let interval: string | null = null;
    let currentPeriodEnd: number | null = tenant.stripeSubscriptionEnd || null;
    let cardBrand: string | null = null;
    let cardLast4: string | null = null;

    if (tenant.stripeSubscriptionId && this.stripe) {
      try {
        const sub = await this.stripe.subscriptions.retrieve(tenant.stripeSubscriptionId);
        const price = sub.items.data[0]?.price;
        if (price) {
          interval = price.recurring?.interval === 'year' ? 'anual' : 'mensal';
        }
        currentPeriodEnd = sub.current_period_end;

        if (sub.default_payment_method) {
          const pmId = typeof sub.default_payment_method === 'string' ? sub.default_payment_method : sub.default_payment_method.id;
          const pm = await this.stripe.paymentMethods.retrieve(pmId);
          if (pm.card) {
            cardBrand = pm.card.brand;
            cardLast4 = pm.card.last4;
          }
        }
      } catch (err: any) {
        this.logger.error(`Failed to fetch Stripe details: ${err.message}`);
      }
    }

    return {
      plan: tenant.plan,
      stripeSubscriptionStatus: tenant.stripeSubscriptionStatus,
      stripeCustomerId: tenant.stripeCustomerId,
      stripeSubscriptionEnd: currentPeriodEnd,
      interval,
      cardBrand,
      cardLast4,
    };
  }
}
