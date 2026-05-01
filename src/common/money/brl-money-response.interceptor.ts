import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { formatMonetaryValuesInJson } from './brl-money';

/**
 * Converte números monetários em strings `pt-BR` (ex.: `1.234,56`) nas respostas JSON.
 * Desative com `BRL_DISABLE_MONETARY_RESPONSE_FORMAT=1` se o cliente precisar de números crus.
 */
@Injectable()
export class BrlMoneyResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const disabled =
      String(process.env.BRL_DISABLE_MONETARY_RESPONSE_FORMAT ?? '')
        .trim()
        .toLowerCase() === '1' ||
      String(process.env.BRL_DISABLE_MONETARY_RESPONSE_FORMAT ?? '')
        .trim()
        .toLowerCase() === 'true';
    if (disabled) {
      return next.handle();
    }
    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile) return data;
        if (data === null || data === undefined) return data;
        return formatMonetaryValuesInJson(data);
      }),
    );
  }
}
