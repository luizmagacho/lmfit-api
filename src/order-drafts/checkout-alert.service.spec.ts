import * as Sentry from '@sentry/nestjs';
import { Types } from 'mongoose';
import { CheckoutAlertService } from './checkout-alert.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

describe('CheckoutAlertService.reportSubmitFailure', () => {
  const notify: any = { sendStaffEmail: jest.fn().mockResolvedValue(undefined) };
  const config: any = { get: jest.fn() };
  const tenantId = new Types.ObjectId().toString();

  const service = new CheckoutAlertService(notify, config);

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockReturnValue(undefined);
  });

  it('AC10: reporta ao Sentry com tenantId e o motivo, mesmo pra um erro que "parece" rejeição de negócio', async () => {
    // A comparação por status HTTP some aqui de propósito — resolveLines() lançava exatamente
    // este tipo de BadRequestException no bug de 12/08, e SentryGlobalFilter (global) não reporta
    // HttpException < 500 por padrão. captureException() precisa acontecer de qualquer jeito.
    const err = new Error('Preço de atacado exige quantidade mínima de 6 (solicitado 1).');

    await service.reportSubmitFailure(tenantId, err);

    expect(Sentry.captureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({
        tags: expect.objectContaining({ tenantId }),
        extra: expect.objectContaining({ reason: err.message }),
      }),
    );
  });

  it('AC10: manda e-mail de staff no primeiro disparo', async () => {
    await service.reportSubmitFailure(tenantId, new Error('boom'));

    expect(notify.sendStaffEmail).toHaveBeenCalledWith(
      expect.stringContaining(tenantId),
      expect.stringContaining('boom'),
    );
  });

  it('AC10: faz dedup — a mesma falha (tenant + motivo) duas vezes na janela manda só 1 e-mail', async () => {
    config.get.mockImplementation((key: string) =>
      key === 'CHECKOUT_ALERT_DEDUP_MINUTES' ? '60' : undefined,
    );

    await service.reportSubmitFailure(tenantId, new Error('Estoque insuficiente para X'));
    await service.reportSubmitFailure(tenantId, new Error('Estoque insuficiente para X'));

    expect(notify.sendStaffEmail).toHaveBeenCalledTimes(1);
    // Sentry, ao contrário do e-mail, recebe TODAS as ocorrências — dedup é só do e-mail (o
    // Sentry já agrupa por fingerprint sozinho, e perder um evento lá custa mais que um e-mail a mais).
    expect(Sentry.captureException).toHaveBeenCalledTimes(2);
  });

  it('AC10: motivos diferentes no mesmo tenant NÃO fazem dedup entre si', async () => {
    await service.reportSubmitFailure(tenantId, new Error('Motivo A'));
    await service.reportSubmitFailure(tenantId, new Error('Motivo B'));

    expect(notify.sendStaffEmail).toHaveBeenCalledTimes(2);
  });

  it('AC10: o mesmo motivo em tenants diferentes NÃO faz dedup entre si', async () => {
    const otherTenantId = new Types.ObjectId().toString();

    await service.reportSubmitFailure(tenantId, new Error('Falha genérica'));
    await service.reportSubmitFailure(otherTenantId, new Error('Falha genérica'));

    expect(notify.sendStaffEmail).toHaveBeenCalledTimes(2);
  });

  it('AC10: fora da janela de dedup, manda e-mail de novo', async () => {
    config.get.mockImplementation((key: string) =>
      key === 'CHECKOUT_ALERT_DEDUP_MINUTES' ? '60' : undefined,
    );
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000_000);
    await service.reportSubmitFailure(tenantId, new Error('Falha repetida'));

    // 61 minutos depois — fora da janela de 60.
    nowSpy.mockReturnValue(1_000_000 + 61 * 60_000);
    await service.reportSubmitFailure(tenantId, new Error('Falha repetida'));

    expect(notify.sendStaffEmail).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });

  it('nunca deixa a falha do próprio sendStaffEmail escapar (best-effort)', async () => {
    notify.sendStaffEmail.mockRejectedValueOnce(new Error('SMTP down'));

    await expect(service.reportSubmitFailure(tenantId, new Error('x'))).resolves.toBeUndefined();
  });
});
