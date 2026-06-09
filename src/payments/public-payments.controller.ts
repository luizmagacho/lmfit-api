import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
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
    const expected = this.config.get<string>('PAYMENT_DEV_CONFIRM_KEY')?.trim();
    if (!expected || headerKey !== expected) {
      throw new ForbiddenException();
    }
    await this.payments.confirmPixPaymentPaid(id);
    return { ok: true };
  }

  /** Simulação pública para testes locais de checkout. */
  @Post(':id/simulate-confirm')
  async simulateConfirm(@Param('id') id: string) {
    await this.payments.confirmPixPaymentPaid(id);
    return { ok: true };
  }
}
