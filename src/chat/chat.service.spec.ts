import { ChatService } from './chat.service';

function makeDeps() {
  const catalog: any = { listProducts: jest.fn().mockResolvedValue({ items: [] }) };
  const llm: any = { chatReplyWithAction: jest.fn() };
  const leads: any = { createFromChat: jest.fn().mockResolvedValue(undefined) };
  return { catalog, llm, leads, service: new ChatService(catalog, llm, leads) };
}

const shippingOptions = [
  { value: 'pickup', label: 'Retirada em Loja', fee: 0 },
  { value: 'standard', label: 'Entrega padrão', fee: 19.9 },
];

describe('ChatService.reply — confirm_order (Loop 11-C, opt-in only)', () => {
  it('never mentions confirm_order in the prompt when whatsappOrderContext is not passed (web widget path, unchanged)', async () => {
    const { service, llm } = makeDeps();
    llm.chatReplyWithAction.mockResolvedValue({ reply: 'oi', actions: [] });

    await service.reply('tenant-1', { message: 'oi' });

    const [systemPrompt] = llm.chatReplyWithAction.mock.calls.at(-1)!;
    expect(systemPrompt).not.toContain('confirm_order');
  });

  it('includes the real shipping options in the prompt when whatsappOrderContext is passed', async () => {
    const { service, llm } = makeDeps();
    llm.chatReplyWithAction.mockResolvedValue({ reply: 'oi', actions: [] });

    await service.reply('tenant-1', { message: 'fecha o pedido' }, [], { shippingOptions });

    const [systemPrompt] = llm.chatReplyWithAction.mock.calls.at(-1)!;
    expect(systemPrompt).toContain('confirm_order');
    expect(systemPrompt).toContain('Entrega padrão');
    expect(systemPrompt).toContain('19,90');
    expect(systemPrompt).toContain('R$');
  });

  it('resolves a valid confirm_order action when the shippingOption matches a real option', async () => {
    const { service, llm } = makeDeps();
    llm.chatReplyWithAction.mockResolvedValue({
      reply: 'Fechando!',
      actions: [{ type: 'confirm_order', name: 'Ana', shippingOption: 'standard' }],
    });

    const { actions } = await service.reply('tenant-1', { message: 'confirma' }, [], { shippingOptions });

    expect(actions).toEqual([{ type: 'confirm_order', name: 'Ana', shippingOption: 'standard' }]);
  });

  it('drops a confirm_order action whose shippingOption the LLM invented (not one of the real options)', async () => {
    const { service, llm } = makeDeps();
    llm.chatReplyWithAction.mockResolvedValue({
      reply: 'Fechando!',
      actions: [{ type: 'confirm_order', name: 'Ana', shippingOption: 'sedex-10-invented' }],
    });

    const { actions } = await service.reply('tenant-1', { message: 'confirma' }, [], { shippingOptions });

    expect(actions).toEqual([]);
  });

  it('drops a confirm_order action missing a name', async () => {
    const { service, llm } = makeDeps();
    llm.chatReplyWithAction.mockResolvedValue({
      reply: 'Fechando!',
      actions: [{ type: 'confirm_order', name: '', shippingOption: 'standard' }],
    });

    const { actions } = await service.reply('tenant-1', { message: 'confirma' }, [], { shippingOptions });

    expect(actions).toEqual([]);
  });

  it('drops a confirm_order action entirely when whatsappOrderContext was never passed (web widget can never trigger it)', async () => {
    const { service, llm } = makeDeps();
    llm.chatReplyWithAction.mockResolvedValue({
      reply: 'ok',
      actions: [{ type: 'confirm_order', name: 'Ana', shippingOption: 'standard' }],
    });

    const { actions } = await service.reply('tenant-1', { message: 'oi' });

    expect(actions).toEqual([]);
  });
});
