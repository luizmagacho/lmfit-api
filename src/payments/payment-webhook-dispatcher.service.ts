import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac } from 'crypto';
import { Model, Types } from 'mongoose';
import * as Sentry from '@sentry/nestjs';
import { FailedWebhook, FailedWebhookDocument } from './schemas/failed-webhook.schema';

/** Delay before each retry attempt, in ms. First send is attempt 0 (no delay). */
const RETRY_DELAYS_MS = [500, 1500, 4000];

type PaymentEventBody = {
  paymentId: string;
  orderId: string;
  status: string;
  amount: number;
  paidAt?: string;
  tenantId?: string;
};

@Injectable()
export class PaymentWebhookDispatcherService {
  private readonly log = new Logger(PaymentWebhookDispatcherService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectModel(FailedWebhook.name)
    private readonly failedWebhookModel: Model<FailedWebhookDocument>,
  ) {}

  /** Loop 10 — retorno passou de `void` pra `boolean` (entrega confirmada ou não) só pra dar ao
   *  DLQ replay (abaixo) como saber se deve marcar `resolved: true`; os dois chamadores existentes
   *  (webhook de pagamento pago/expirado) já ignoravam o retorno, então não muda nada pra eles. */
  async dispatchPaymentEvent(
    event: 'payment.paid' | 'payment.expired' | 'payment.refunded',
    body: PaymentEventBody,
  ): Promise<boolean> {
    const url = this.config.get<string>('WEBHOOK_URL')?.trim();
    if (!url) return true;
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
        if (res.ok) return true;
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
    return false;
  }

  /** Loop 10 — DLQ replay. `FailedWebhook` existia só como trilha de auditoria write-only desde
   *  que os retries automáticos foram implementados (campo `resolved` nunca lido em lugar nenhum
   *  até agora). Reusa `dispatchPaymentEvent` (mesmo retry+backoff, mesmo comportamento de
   *  persistir de novo se falhar outra vez) em vez de um fetch avulso — replay é só um novo
   *  disparo do mesmo evento, não um caminho de erro diferente. */
  async replayFailedWebhook(tenantId: string, failedWebhookId: string): Promise<{ delivered: boolean }> {
    if (!Types.ObjectId.isValid(failedWebhookId)) throw new NotFoundException();
    const doc = await this.failedWebhookModel
      .findOne({ _id: failedWebhookId, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!doc) throw new NotFoundException();

    const { event, ...body } = doc.payload as { event: PaymentWebhookEvent } & PaymentEventBody;
    const delivered = await this.dispatchPaymentEvent(event, body);
    if (delivered) {
      doc.resolved = true;
      await doc.save();
    }
    return { delivered };
  }

  async listFailedWebhooks(tenantId: string, onlyUnresolved = true) {
    return this.failedWebhookModel
      .find({
        tenantId: new Types.ObjectId(tenantId),
        ...(onlyUnresolved ? { resolved: false } : {}),
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }
}

type PaymentWebhookEvent = 'payment.paid' | 'payment.expired' | 'payment.refunded';
