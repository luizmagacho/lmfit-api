import { ForbiddenException } from '@nestjs/common';
import { PublicPaymentsController } from './public-payments.controller';

function makeController(env: Record<string, string | undefined>) {
  const payments: any = {
    confirmPixPaymentPaid: jest.fn().mockResolvedValue(undefined),
    confirmInfinitePayPaymentPaid: jest.fn().mockResolvedValue(undefined),
  };
  const config: any = { get: jest.fn((key: string) => env[key]) };
  const controller = new PublicPaymentsController(payments, config);
  return { controller, payments, config };
}

describe('PublicPaymentsController — dev-confirm gating', () => {
  it('AC10-adjacent: rejects without PAYMENT_DEV_CONFIRM_KEY configured', async () => {
    const { controller, payments } = makeController({});
    await expect(controller.devConfirm('p1', 'anything')).rejects.toThrow(ForbiddenException);
    expect(payments.confirmPixPaymentPaid).not.toHaveBeenCalled();
  });

  it('rejects with a wrong header key', async () => {
    const { controller, payments } = makeController({ PAYMENT_DEV_CONFIRM_KEY: 'secret' });
    await expect(controller.devConfirm('p1', 'wrong')).rejects.toThrow(ForbiddenException);
    expect(payments.confirmPixPaymentPaid).not.toHaveBeenCalled();
  });

  it('accepts the correct header key', async () => {
    const { controller, payments } = makeController({ PAYMENT_DEV_CONFIRM_KEY: 'secret' });
    await controller.devConfirm('p1', 'secret');
    expect(payments.confirmPixPaymentPaid).toHaveBeenCalledWith('p1');
  });
});

describe('PublicPaymentsController.simulateConfirm — AC10 (production gate)', () => {
  it('rejects in production regardless of caller — closes the "anyone can mark paid" hole', async () => {
    const { controller, payments } = makeController({ NODE_ENV: 'production' });
    await expect(controller.simulateConfirm('p1')).rejects.toThrow(ForbiddenException);
    expect(payments.confirmPixPaymentPaid).not.toHaveBeenCalled();
  });

  it('still works outside production (local/staging QA tool)', async () => {
    const { controller, payments } = makeController({ NODE_ENV: 'development' });
    await controller.simulateConfirm('p1');
    expect(payments.confirmPixPaymentPaid).toHaveBeenCalledWith('p1');
  });
});

describe('PublicPaymentsController.infinitePayWebhook — AC7 (signature/secret validation)', () => {
  it('rejects when PAYMENT_WEBHOOK_SECRET is not configured, even with a payload', async () => {
    const { controller, payments } = makeController({});
    await expect(
      controller.infinitePayWebhook({ order_nsu: 'pay1' }, 'any-secret'),
    ).rejects.toThrow(ForbiddenException);
    expect(payments.confirmInfinitePayPaymentPaid).not.toHaveBeenCalled();
  });

  it('rejects a forged order_nsu payload with a missing secret query param', async () => {
    const { controller, payments } = makeController({ PAYMENT_WEBHOOK_SECRET: 'wh-secret' });
    await expect(
      controller.infinitePayWebhook({ order_nsu: 'pay1' }, undefined),
    ).rejects.toThrow(ForbiddenException);
    expect(payments.confirmInfinitePayPaymentPaid).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret', async () => {
    const { controller, payments } = makeController({ PAYMENT_WEBHOOK_SECRET: 'wh-secret' });
    await expect(
      controller.infinitePayWebhook({ order_nsu: 'pay1' }, 'wrong-secret'),
    ).rejects.toThrow(ForbiddenException);
    expect(payments.confirmInfinitePayPaymentPaid).not.toHaveBeenCalled();
  });

  it('confirms payment when the secret matches', async () => {
    const { controller, payments } = makeController({ PAYMENT_WEBHOOK_SECRET: 'wh-secret' });
    const res = await controller.infinitePayWebhook(
      { order_nsu: 'pay1', transaction_nsu: 'nsu-1', capture_method: 'pix' },
      'wh-secret',
    );
    expect(payments.confirmInfinitePayPaymentPaid).toHaveBeenCalledWith('pay1', 'nsu-1', 'pix');
    expect(res).toEqual({ success: true });
  });

  it('AC5: a replayed webhook (already processed) responds success without re-confirming', async () => {
    const { controller, payments } = makeController({ PAYMENT_WEBHOOK_SECRET: 'wh-secret' });
    payments.confirmInfinitePayPaymentPaid.mockRejectedValueOnce(
      new Error('Pagamento não está pendente'),
    );
    const res = await controller.infinitePayWebhook({ order_nsu: 'pay1' }, 'wh-secret');
    expect(res).toEqual({ success: true, message: 'Already processed' });
  });
});
