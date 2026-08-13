import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { NotificationsService } from '../notifications/notifications.service';

const DEFAULT_DEDUP_MINUTES = 60;

/**
 * Loop 26 — observabilidade de falha real do submit público. `SentryGlobalFilter` (já global em
 * app.module.ts) só reporta exceções não-tratadas de verdade — por padrão, o SDK do Sentry pra
 * NestJS não reporta `HttpException` com status < 500, porque trata rejeição de negócio (400/422)
 * como esperada, não como bug. Essa é EXATAMENTE a categoria em que o bug de 12/08 vivia: uma
 * `BadRequestException` "esperada" que na real era o checkout inteiro quebrado. Por isso este
 * serviço captura toda falha do submit explicitamente, sem filtrar por tipo — ver a decisão
 * "Falha de negócio vs. de bug" no spec do Loop 26.
 */
@Injectable()
export class CheckoutAlertService {
  private readonly log = new Logger(CheckoutAlertService.name);
  /** dedup em memória por processo — aceitável na v1 (ver Risco/Decisão no spec): um alerta
   *  duplicado por réplica, se a API escalar horizontalmente, é um custo bem menor que silenciar
   *  o alerta inteiro. */
  private readonly lastAlertAt = new Map<string, number>();

  constructor(
    private readonly notify: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async reportSubmitFailure(tenantId: string, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);

    Sentry.captureException(err, {
      tags: { scope: 'public-order-drafts-submit', tenantId },
      extra: { reason: message },
    });

    const dedupMinutes = Number(
      this.config.get<string>('CHECKOUT_ALERT_DEDUP_MINUTES') ?? DEFAULT_DEDUP_MINUTES,
    );
    const key = `${tenantId}:${message}`;
    const now = Date.now();
    const last = this.lastAlertAt.get(key);
    if (last !== undefined && now - last < dedupMinutes * 60_000) {
      this.log.debug(`Submit falhou de novo (tenant ${tenantId}) — dentro da janela de dedup, sem novo e-mail.`);
      return;
    }
    this.lastAlertAt.set(key, now);

    await this.notify
      .sendStaffEmail(
        `[Kivoni] Falha no checkout público (tenant ${tenantId})`,
        `Um cliente teve o pedido rejeitado ao tentar finalizar a compra:\n\n${message}\n\n` +
          `Se isso não for uma rejeição de negócio esperada (ex.: estoque insuficiente digitado ` +
          `errado pelo cliente), pode ser um bug travando checkout pra mais gente — o mesmo tipo ` +
          `de falha que o Loop 26 foi criado pra pegar.`,
      )
      .catch(() => undefined);
  }
}
