import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac } from 'crypto';
import { Model } from 'mongoose';
import * as Sentry from '@sentry/nestjs';
import { FailedWebhook, FailedWebhookDocument } from './schemas/failed-webhook.schema';

/** Delay before each retry attempt, in ms. First send is attempt 0 (no delay). */
const RETRY_DELAYS_MS = [500, 1500, 4000];

@Injectable()
export class PaymentWebhookDispatcherService {
  private readonly log = new Logger(PaymentWebhookDispatcherService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectModel(FailedWebhook.name)
    private readonly failedWebhookModel: Model<FailedWebhookDocument>,
  ) {}

  async dispatchPaymentEvent(
    event: 'payment.paid' | 'payment.expired' | 'payment.refunded',
    body: {
      paymentId: string;
      orderId: string;
      status: string;
      amount: number;
      paidAt?: string;
      tenantId?: string;
    },
  ): Promise<void> {
    const url = this.config.get<string>('WEBHOOK_URL')?.trim();
    if (!url) return;
    const secret = this.config.get<string>('WEBHOOK_SECRET')?.trim();
    const payload = JSON.stringify({ event, ...body });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (secret) {
      headers['X-Signature'] = createHmac('sha256', secret).update(payload).digest('hex');
    }

    let lastError = '';
    const totalAttempts = RETRY_DELAYS_MS.length + 1;
    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      try {
        const res = await fetch(url, { method: 'POST', headers, body: payload });
        if (res.ok) return;
        lastError = `HTTP ${res.status}`;
        this.log.warn(`Webhook POST ${url} returned ${res.status} (attempt ${attempt}/${totalAttempts})`);
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        this.log.warn(`Webhook dispatch failed (attempt ${attempt}/${totalAttempts}): ${lastError}`);
      }
      if (attempt < totalAttempts) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]));
      }
    }

    // All retries exhausted: this must not vanish silently — persist + alert.
    this.log.error(
      `Webhook ${event} for payment ${body.paymentId} failed after ${totalAttempts} attempts: ${lastError}`,
    );
    Sentry.captureMessage(`Payment webhook dispatch exhausted retries: ${event}`, {
      level: 'error',
      tags: { event, paymentId: body.paymentId, orderId: body.orderId, tenantId: body.tenantId },
    });
    await this.failedWebhookModel.create({
      tenantId: body.tenantId,
      event,
      payload: { event, ...body },
      url,
      lastError,
      attempts: totalAttempts,
    });
  }
}
