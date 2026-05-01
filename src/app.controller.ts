import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { digitsAsCentsToReais, formatBrlCurrency } from './common/money/brl-money';

@ApiTags('health')
@Controller()
@SkipThrottle()
export class AppController {
  @Get('health')
  health() {
    return { ok: true, service: 'lmfit-api' };
  }

  @ApiTags('utils')
  @Get('utils/money/from-digits')
  @ApiOperation({
    summary:
      'Converte só dígitos em reais (estilo caixa: 9→0,09 · 95→0,95 · 9599→95,99) e devolve formatado pt-BR',
  })
  moneyFromDigits(@Query('digits') digits = '') {
    const value = digitsAsCentsToReais(String(digits));
    return { value, formatted: formatBrlCurrency(value) };
  }
}
