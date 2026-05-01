import { Transform } from 'class-transformer';
import { parseBrlMoneyInput } from './brl-money';

/** Aceita número JSON, string `1.234,56` ou só dígitos como centavos acumulados (`9599` → 95,99). */
export function BrlMoney(): PropertyDecorator {
  return Transform(({ value }) => parseBrlMoneyInput(value));
}
