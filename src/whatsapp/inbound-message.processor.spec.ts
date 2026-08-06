import { InboundMessageProcessor } from './inbound-message.processor';

function makeDoc(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    wamid: 'wamid.1',
    fromWaId: '5511999998888',
    textBody: 'Oi, vocês têm camisa M?',
    tenantId: { toString: () => 'tenant-1' },
    ...overrides,
  } as any;
}

function makeDeps() {
  const config: any = { get: jest.fn().mockReturnValue(undefined) };
  const senders: any = { isAllowed: jest.fn(), findByWaId: jest.fn().mockResolvedValue(null) };
  const messages: any = { updateOne: jest.fn().mockResolvedValue(undefined) };
  const llm: any = { parseIntent: jest.fn() };
  const orders: any = { create: jest.fn(), syncBatch: jest.fn() };
  const purchases: any = { create: jest.fn() };
  const customers: any = {
    findFirstByHint: jest.fn(),
    findByWaId: jest.fn(),
    getOrCreateWalkIn: jest.fn().mockResolvedValue({ _id: 'walkin-1' }),
  };
  const suppliers: any = { findFirstByHint: jest.fn() };
  const notify: any = { sendStaffEmail: jest.fn().mockResolvedValue(undefined) };
  const tenants: any = { findById: jest.fn() };
  const whatsappChat: any = { handleCustomerMessage: jest.fn().mockResolvedValue(undefined) };
  const media: any = { downloadAudio: jest.fn() };
  const catalog: any = { listProducts: jest.fn().mockResolvedValue({ items: [] }) };
  const users: any = { findById: jest.fn() };
  const sender: any = { sendText: jest.fn().mockResolvedValue(true) };

  const processor = new InboundMessageProcessor(
    config,
    senders,
    messages,
    llm,
    orders,
    purchases,
    customers,
    suppliers,
    notify,
    tenants,
    whatsappChat,
    media,
    catalog,
    users,
    sender,
  );

  return {
    processor,
    config,
    senders,
    messages,
    llm,
    orders,
    purchases,
    customers,
    suppliers,
    notify,
    tenants,
    whatsappChat,
    media,
    catalog,
    users,
    sender,
  };
}

describe('InboundMessageProcessor — Loop 11-B non-staff branch', () => {
  it('routes a non-allowlisted sender to the AI when the tenant has whatsappAiEnabled', async () => {
    const { processor, senders, tenants, whatsappChat, messages, notify } = makeDeps();
    senders.isAllowed.mockResolvedValue(false);
    const tenant = { _id: 'tenant-1', slug: 'kivoni', whatsappAiEnabled: true };
    tenants.findById.mockResolvedValue(tenant);

    await processor.process(makeDoc());

    expect(whatsappChat.handleCustomerMessage).toHaveBeenCalledWith(tenant, '5511999998888', 'Oi, vocês têm camisa M?');
    expect(messages.updateOne).toHaveBeenCalledWith('wamid.1', { processingStatus: 'ai_replied' });
    expect(notify.sendStaffEmail).not.toHaveBeenCalled();
  });

  it('falls back to staff-email escalation (unchanged) when whatsappAiEnabled is off', async () => {
    const { processor, senders, tenants, whatsappChat, messages, notify } = makeDeps();
    senders.isAllowed.mockResolvedValue(false);
    tenants.findById.mockResolvedValue({ _id: 'tenant-1', slug: 'kivoni', whatsappAiEnabled: false });

    await processor.process(makeDoc());

    expect(whatsappChat.handleCustomerMessage).not.toHaveBeenCalled();
    expect(messages.updateOne).toHaveBeenCalledWith('wamid.1', {
      processingStatus: 'escalated',
      error: 'sender_not_allowlisted',
    });
    expect(notify.sendStaffEmail).toHaveBeenCalled();
  });

  it('falls back to staff-email escalation when the tenant lookup itself fails', async () => {
    const { processor, senders, tenants, whatsappChat, messages, notify } = makeDeps();
    senders.isAllowed.mockResolvedValue(false);
    tenants.findById.mockRejectedValue(new Error('bad tenantId'));

    await processor.process(makeDoc());

    expect(whatsappChat.handleCustomerMessage).not.toHaveBeenCalled();
    expect(messages.updateOne).toHaveBeenCalledWith('wamid.1', {
      processingStatus: 'escalated',
      error: 'sender_not_allowlisted',
    });
    expect(notify.sendStaffEmail).toHaveBeenCalled();
  });

  it('does not touch the AI path at all for an allowlisted (staff) sender — ERP pipeline runs untouched', async () => {
    const { processor, senders, llm, whatsappChat, tenants } = makeDeps();
    senders.isAllowed.mockResolvedValue(true);
    llm.parseIntent.mockResolvedValue({ intent: 'UNKNOWN', confidence: 0.1, needs_clarification: false, entities: {} });

    await processor.process(makeDoc());

    expect(whatsappChat.handleCustomerMessage).not.toHaveBeenCalled();
    expect(tenants.findById).not.toHaveBeenCalled();
  });
});

describe('InboundMessageProcessor — Loop 12-A voice messages', () => {
  it('downloads and transcribes audio, then runs the rest of the pipeline exactly as if it had been typed', async () => {
    const { processor, senders, tenants, media, llm, messages } = makeDeps();
    const tenant = { _id: 'tenant-1', slug: 'kivoni' };
    tenants.findById.mockResolvedValue(tenant);
    media.downloadAudio.mockResolvedValue(Buffer.from('fake-audio'));
    llm.transcribeAudio = jest.fn().mockResolvedValue('Vendi uma camisa preta M por 100 reais');
    senders.isAllowed.mockResolvedValue(true);
    llm.parseIntent.mockResolvedValue({ intent: 'UNKNOWN', confidence: 0.1, needs_clarification: false, entities: {} });

    await processor.process(makeDoc({ textBody: undefined, audioMediaId: 'media-1', audioMimeType: 'audio/ogg' }));

    expect(media.downloadAudio).toHaveBeenCalledWith(tenant, 'media-1');
    expect(llm.transcribeAudio).toHaveBeenCalledWith(Buffer.from('fake-audio'), 'audio/ogg');
    expect(messages.updateOne).toHaveBeenCalledWith('wamid.1', { textBody: 'Vendi uma camisa preta M por 100 reais' });
    expect(llm.parseIntent).toHaveBeenCalledWith('Vendi uma camisa preta M por 100 reais');
  });

  it('marks failed (not escalated as empty_text) when the tenant lookup fails for an audio message', async () => {
    const { processor, tenants, media, messages } = makeDeps();
    tenants.findById.mockRejectedValue(new Error('bad id'));

    await processor.process(makeDoc({ textBody: undefined, audioMediaId: 'media-1' }));

    expect(media.downloadAudio).not.toHaveBeenCalled();
    expect(messages.updateOne).toHaveBeenCalledWith('wamid.1', { processingStatus: 'failed', error: 'tenant_not_found' });
  });

  it('marks failed when the audio download itself fails (returns null)', async () => {
    const { processor, tenants, media, messages } = makeDeps();
    tenants.findById.mockResolvedValue({ _id: 'tenant-1', slug: 'kivoni' });
    media.downloadAudio.mockResolvedValue(null);

    await processor.process(makeDoc({ textBody: undefined, audioMediaId: 'media-1' }));

    expect(messages.updateOne).toHaveBeenCalledWith('wamid.1', { processingStatus: 'failed', error: 'audio_download_failed' });
  });

  it('marks failed when transcription throws', async () => {
    const { processor, tenants, media, llm, messages } = makeDeps();
    tenants.findById.mockResolvedValue({ _id: 'tenant-1', slug: 'kivoni' });
    media.downloadAudio.mockResolvedValue(Buffer.from('audio'));
    llm.transcribeAudio = jest.fn().mockRejectedValue(new Error('groq down'));

    await processor.process(makeDoc({ textBody: undefined, audioMediaId: 'media-1' }));

    const call = messages.updateOne.mock.calls.find((c: any[]) => c[1]?.processingStatus === 'failed');
    expect(call?.[1].error).toContain('transcription_failed');
  });

  it('still escalates as empty_text for a normal message with no audioMediaId and no text (unrelated regression check)', async () => {
    const { processor, media, messages } = makeDeps();

    await processor.process(makeDoc({ textBody: '' }));

    expect(media.downloadAudio).not.toHaveBeenCalled();
    expect(messages.updateOne).toHaveBeenCalledWith('wamid.1', { processingStatus: 'escalated', error: 'empty_text' });
  });
});

describe('InboundMessageProcessor — Loop 12-B: staff sale (voice or text) routes through syncBatch', () => {
  const realMadrid = {
    _id: 'prod-real',
    name: 'Camisa Real Madrid I 2024',
    category: 'Camisas',
    variants: [{ _id: 'var-real-g', size: 'G', sku: 'FUT-CRM-G', priceRetail: 299.9 }],
  };
  const flamengo = {
    _id: 'prod-fla',
    name: 'Camisa Flamengo I 2024',
    category: 'Camisas',
    variants: [{ _id: 'var-fla-g', size: 'G', sku: 'FUT-CFI-G', priceRetail: 299.9 }],
  };

  function setupHappyPath(deps = makeDeps()) {
    deps.senders.isAllowed.mockResolvedValue(true);
    deps.senders.findByWaId.mockResolvedValue({ linkedUserId: 'user-1' });
    deps.users.findById.mockResolvedValue({ assignedLocationId: 'loc-1' });
    deps.tenants.findById.mockResolvedValue({ _id: 'tenant-1', slug: 'kivoni' });
    deps.catalog.listProducts.mockResolvedValue({ items: [realMadrid, flamengo] });
    deps.llm.parseIntent.mockResolvedValue({
      intent: 'CREATE_ORDER',
      confidence: 0.9,
      needs_clarification: false,
      entities: {
        lines: [{ description: 'camisa Real Madrid', size: 'G', qty: 1 }],
        paymentMethod: 'cash',
      },
    });
    deps.orders.syncBatch.mockResolvedValue([
      { clientSaleId: 'wamid.1', orderId: '507f1f77bcf86cd799439011', orderNumber: 47, status: 'ok' },
    ]);
    return deps;
  }

  it('resolves the location via linkedUserId and the product deterministically, then deducts real stock via syncBatch (never trusting the LLM for variantId/price)', async () => {
    const { processor, orders, messages, sender } = setupHappyPath();

    await processor.process(makeDoc());

    expect(orders.syncBatch).toHaveBeenCalledWith(
      'tenant-1',
      'loc-1',
      [
        expect.objectContaining({
          clientSaleId: 'wamid.1',
          paymentMethod: 'cash',
          lines: [{ variantId: 'var-real-g', quantity: 1, unitPrice: 299.9 }],
        }),
      ],
      'user-1',
    );
    expect(messages.updateOne).toHaveBeenCalledWith('wamid.1', {
      processingStatus: 'auto_posted',
      linkedOrderId: expect.anything(),
    });
    const [, , replyText] = sender.sendText.mock.calls[0];
    expect(replyText).toContain('Venda #47');
    expect(replyText).toContain('Camisa Real Madrid I 2024');
    expect(replyText).not.toContain('Flamengo');
    expect(replyText).toContain('Dinheiro');
  });

  it('regression: "camisa Real Madrid" must never resolve to the Flamengo variant even when both exist in the catalog', async () => {
    const { processor, orders } = setupHappyPath();

    await processor.process(makeDoc());

    const [[, , sales]] = orders.syncBatch.mock.calls;
    expect(sales[0].lines[0].variantId).toBe('var-real-g');
  });

  it('escalates without deducting stock when the seller has no assigned location — never guesses which store to deduct from', async () => {
    const deps = setupHappyPath();
    deps.users.findById.mockResolvedValue({ assignedLocationId: undefined });

    await deps.processor.process(makeDoc());

    expect(deps.orders.syncBatch).not.toHaveBeenCalled();
    expect(deps.messages.updateOne).toHaveBeenCalledWith('wamid.1', {
      processingStatus: 'escalated',
      error: 'missing_location',
    });
    expect(deps.notify.sendStaffEmail).toHaveBeenCalled();
  });

  it('escalates without deducting stock when the product cannot be identified with confidence', async () => {
    const deps = setupHappyPath();
    deps.llm.parseIntent.mockResolvedValue({
      intent: 'CREATE_ORDER',
      confidence: 0.9,
      needs_clarification: false,
      entities: { lines: [{ description: 'tênis de corrida', size: '42', qty: 1 }] },
    });

    await deps.processor.process(makeDoc());

    expect(deps.orders.syncBatch).not.toHaveBeenCalled();
    const call = deps.messages.updateOne.mock.calls.find((c: any[]) => c[1]?.processingStatus === 'escalated');
    expect(call?.[1].error).toContain('product_not_found');
    expect(deps.notify.sendStaffEmail).toHaveBeenCalled();
  });

  it('falls back to the walk-in customer when no customer hint or record is found', async () => {
    const deps = setupHappyPath();
    deps.customers.findByWaId.mockResolvedValue(null);

    await deps.processor.process(makeDoc());

    const [[, , sales]] = deps.orders.syncBatch.mock.calls;
    expect(sales[0].customerId).toBe('walkin-1');
  });

  it('defaults paymentMethod to cash when the seller never said how they were paid', async () => {
    const deps = setupHappyPath();
    deps.llm.parseIntent.mockResolvedValue({
      intent: 'CREATE_ORDER',
      confidence: 0.9,
      needs_clarification: false,
      entities: { lines: [{ description: 'camisa Real Madrid', size: 'G', qty: 1 }] },
    });

    await deps.processor.process(makeDoc());

    const [[, , sales]] = deps.orders.syncBatch.mock.calls;
    expect(sales[0].paymentMethod).toBe('cash');
  });

});
