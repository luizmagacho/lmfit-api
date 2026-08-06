import { timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import * as Sentry from '@sentry/nestjs';
import { PaymentsService } from './payments.service';

@ApiTags('public-payments')
@Controller('public/payments')
export class PublicPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly config: ConfigService,
  ) {}

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get(':id')
  async status(@Param('id') id: string) {
    await this.payments.markExpiredIfDue(id);
    return this.payments.findPublicStatusById(id);
  }

  /** Somente dev/homologação: confirma PIX e marca pedido pago (requer `PAYMENT_DEV_CONFIRM_KEY`). */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/dev-confirm')
  async devConfirm(
    @Param('id') id: string,
    @Headers('x-payment-dev-confirm') headerKey?: string,
  ) {
    this.assertDevConfirmAllowed(headerKey);
    await this.payments.confirmPixPaymentPaid(id);
    return { ok: true };
  }

  /**
   * Simulação pública de checkout para dev/homologação — usada pela página local de "Ambiente de
   * Testes" quando o tenant não tem PSP real configurado, sem exigir segredo (o app público não
   * pode carregar um segredo do servidor no bundle do cliente). Em produção fica sempre bloqueada:
   * antes disso, qualquer visitante que descobrisse um paymentId conseguia marcar qualquer
   * pagamento como pago sem pagar nada.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/simulate-confirm')
  async simulateConfirm(@Param('id') id: string) {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException();
    }
    await this.payments.confirmPixPaymentPaid(id);
    return { ok: true };
  }

  private assertDevConfirmAllowed(headerKey?: string): void {
    const expected = this.config.get<string>('PAYMENT_DEV_CONFIRM_KEY')?.trim();
    if (!expected || headerKey !== expected) {
      throw new ForbiddenException();
    }
  }

  /**
   * Webhook oficial da InfinitePay para confirmação de pagamentos. Valida o segredo embutido na
   * query string do `webhook_url` que nós mesmos geramos em `createInfinitePayPayment` — sem essa
   * checagem, qualquer request externo com `{order_nsu: "<paymentId>"}` conseguiria marcar
   * qualquer pagamento pendente como pago.
   */
  @Post('infinitepay-webhook')
  async infinitePayWebhook(@Body() body: any, @Query('secret') secret?: string) {
    this.assertWebhookSecretValid(secret);
    const paymentId = body.order_nsu;
    if (!paymentId) {
      throw new BadRequestException('order_nsu is required');
    }
    try {
      await this.payments.confirmInfinitePayPaymentPaid(
        paymentId,
        body.transaction_nsu,
        body.capture_method,
      );
      return { success: true };
    } catch (e: any) {
      if (e.message?.includes('não está pendente')) {
        return { success: true, message: 'Already processed' };
      }
      console.error('InfinitePay Webhook error:', e);
      Sentry.captureException(e, { tags: { scope: 'infinitepay-webhook', paymentId } });
      throw new BadRequestException(e.message || 'Error processing webhook');
    }
  }

  private assertWebhookSecretValid(secret?: string): void {
    const expected = this.config.get<string>('PAYMENT_WEBHOOK_SECRET')?.trim();
    if (!expected) {
      // Sem segredo configurado não há como validar a origem: rejeita por padrão em vez de
      // aceitar qualquer chamada não autenticada.
      Sentry.captureMessage('InfinitePay webhook called without PAYMENT_WEBHOOK_SECRET configured', {
        level: 'warning',
        tags: { scope: 'infinitepay-webhook' },
      });
      throw new ForbiddenException();
    }
    const provided = (secret ?? '').trim();
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);
    const valid =
      expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
    if (!valid) {
      // Toda tentativa com segredo errado é ruído esperado de scanners — mas um pico súbito pode
      // indicar tentativa de forjar confirmação de pagamento, vale ficar de olho.
      Sentry.captureMessage('InfinitePay webhook rejected: invalid secret', {
        level: 'warning',
        tags: { scope: 'infinitepay-webhook' },
      });
      throw new ForbiddenException();
    }
  }
}
