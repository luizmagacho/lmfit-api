import { BadRequestException } from '@nestjs/common';
import { PublicOrderDraftsController } from './public-order-drafts.controller';

describe('PublicOrderDraftsController.submit — Loop 26 alerta em falha', () => {
  const drafts: any = { submitByToken: jest.fn() };
  const alerts: any = { reportSubmitFailure: jest.fn().mockResolvedValue(undefined) };
  const controller = new PublicOrderDraftsController(drafts, alerts);
  const tenantId = 'tenant-1';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('em sucesso, devolve o resultado normalmente e nunca chama o alerta', async () => {
    drafts.submitByToken.mockResolvedValue({ orderId: 'order-1' });

    const result = await controller.submit(tenantId, 'tok', {} as any);

    expect(result).toEqual({ orderId: 'order-1' });
    expect(alerts.reportSubmitFailure).not.toHaveBeenCalled();
  });

  it('AC10: em falha, reporta o alerta E repropaga a MESMA exceção — o cliente vê o mesmo erro de sempre', async () => {
    const err = new BadRequestException('Estoque insuficiente para X: disponível 2, solicitado 5');
    drafts.submitByToken.mockRejectedValue(err);

    await expect(controller.submit(tenantId, 'tok', {} as any)).rejects.toBe(err);

    expect(alerts.reportSubmitFailure).toHaveBeenCalledWith(tenantId, err);
  });
});
