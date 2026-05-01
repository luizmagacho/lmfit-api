import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

@Injectable()
export class PaymentWebhookDispatcherService {
  private readonly log = new Logger(PaymentWebhookDispatcherService.name);

  constructor(private readonly config: ConfigService) {}

  async dispatchPaymentEvent(
    event: 'payment.paid' | 'payment.expired' | 'payment.refunded',
    body: {
      paymentId: string;
      orderId: string;
      status: string;
      amount: number;
      paidAt?: string;
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
    try {
      const res = await fetch(url, { method: 'POST', headers, body: payload });
      if (!res.ok) {
        this.log.warn(`Webhook POST ${url} returned ${res.status}`);
      }
    } catch (e) {
      this.log.warn(
        `Webhook dispatch failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
