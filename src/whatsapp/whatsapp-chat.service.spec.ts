import { WhatsappChatService } from './whatsapp-chat.service';

function makeTenant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: { toString: () => 'tenant-1' },
    slug: 'kivoni',
    shippingConfig: { pickupLabel: 'Retirada em Loja', standardFee: 19.9, expressFee: 39.9 },
    ...overrides,
  } as any;
}

function makeConversation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    history: [],
    cartLines: [],
    aiEnabled: true,
    ...overrides,
  } as any;
}

describe('WhatsappChatService.handleCustomerMessage', () => {
  let conversations: any;
  let chat: any;
  let sender: any;
  let tenants: any;
  let orderDrafts: any;
  let orders: any;
  let service: WhatsappChatService;
  let conversation: any;

  beforeEach(() => {
    conversation = makeConversation();
    conversations = {
      findOrCreate: jest.fn().mockResolvedValue(conversation),
      appendTurnAndSave: jest.fn().mockResolvedValue(conversation),
    };
    chat = { reply: jest.fn() };
    sender = { sendText: jest.fn().mockResolvedValue(true) };
    tenants = { resolveFeatures: jest.fn().mockReturnValue(['production']) };
    orderDrafts = {
      createPublic: jest.fn(),
      patchByToken: jest.fn(),
      submitByToken: jest.fn(),
    };
    orders = { findOne: jest.fn() };
    service = new WhatsappChatService(conversations, chat, sender, tenants, orderDrafts, orders);
  });

  it('sends the AI reply back through WhatsappSenderService and persists the turn', async () => {
    chat.reply.mockResolvedValue({ reply: 'Temos sim, R$ 299,90!', actions: [] });

    await service.handleCustomerMessage(makeTenant(), '5511999998888', 'Tem camisa do Flamengo?');

    expect(sender.sendText).toHaveBeenCalledWith(expect.anything(), '5511999998888', 'Temos sim, R$ 299,90!');
    expect(conversations.appendTurnAndSave).toHaveBeenCalledWith(
      conversation,
      'Tem camisa do Flamengo?',
      'Temos sim, R$ 299,90!',
    );
  });

  it('passes the persisted history/cart, not an empty one, into ChatService.reply', async () => {
    conversation.history = [{ role: 'user', content: 'oi' }, { role: 'assistant', content: 'olá!' }];
    conversation.cartLines = [{ variantId: 'v1', productName: 'Camisa X', quantity: 2, isOrder: false }];
    chat.reply.mockResolvedValue({ reply: 'ok', actions: [] });

    await service.handleCustomerMessage(makeTenant(), '5511999998888', 'e ai?');

    expect(chat.reply).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        message: 'e ai?',
        history: [{ role: 'user', content: 'oi' }, { role: 'assistant', content: 'olá!' }],
        cartLines: [{ variantId: 'v1', productName: 'Camisa X', quantity: 2, isOrder: false }],
      }),
      ['production'],
      expect.objectContaining({ shippingOptions: expect.any(Array) }),
    );
  });

  it('passes real shipping options (from tenant.shippingConfig) into ChatService.reply, not invented ones', async () => {
    chat.reply.mockResolvedValue({ reply: 'ok', actions: [] });

    await service.handleCustomerMessage(
      makeTenant({ shippingConfig: { pickupLabel: 'Retirar na loja X', standardFee: 25, expressFee: 50 } }),
      '5511999998888',
      'oi',
    );

    const call = chat.reply.mock.calls.at(-1)!;
    expect(call[3].shippingOptions).toEqual([
      { value: 'pickup', label: 'Retirar na loja X', fee: 0 },
      { value: 'standard', label: 'Entrega padrão', fee: 25 },
      { value: 'express', label: 'Entrega expressa', fee: 50 },
    ]);
  });

  it('applies an add_to_cart action to a fresh persisted cart', async () => {
    chat.reply.mockResolvedValue({
      reply: 'Adicionei!',
      actions: [
        {
          type: 'add_to_cart',
          variantId: 'v1',
          productId: 'p1',
          productName: 'Camisa Flamengo I 2024',
          sku: 'FUT-CFI-M',
          priceRetail: 299.9,
          priceWholesale: null,
          minWholesaleQty: 1,
          imageUrl: null,
          quantity: 1,
          isOrder: false,
        },
      ],
    });

    await service.handleCustomerMessage(makeTenant(), '5511999998888', 'quero 1');

    expect(conversation.cartLines).toHaveLength(1);
    expect(conversation.cartLines[0]).toMatchObject({ variantId: 'v1', quantity: 1 });
  });

  it('merges an add_to_cart action into an existing line for the same variant (sums quantity)', async () => {
    conversation.cartLines = [
      { variantId: 'v1', productId: 'p1', productName: 'Camisa X', sku: 's', priceRetail: 100, priceWholesale: null, minWholesaleQty: 1, imageUrl: null, quantity: 2, isOrder: false },
    ];
    chat.reply.mockResolvedValue({
      reply: 'Mais 1!',
      actions: [{ type: 'add_to_cart', variantId: 'v1', productId: 'p1', productName: 'Camisa X', sku: 's', priceRetail: 100, priceWholesale: null, minWholesaleQty: 1, imageUrl: null, quantity: 1, isOrder: false }],
    });

    await service.handleCustomerMessage(makeTenant(), '5511999998888', 'mais 1');

    expect(conversation.cartLines).toHaveLength(1);
    expect(conversation.cartLines[0].quantity).toBe(3);
  });

  it('removes the whole line on remove_from_cart with quantity null', async () => {
    conversation.cartLines = [
      { variantId: 'v1', productId: 'p1', productName: 'Camisa X', sku: 's', priceRetail: 100, priceWholesale: null, minWholesaleQty: 1, imageUrl: null, quantity: 3, isOrder: false },
    ];
    chat.reply.mockResolvedValue({
      reply: 'Removido!',
      actions: [{ type: 'remove_from_cart', variantId: 'v1', isOrder: false, quantity: null }],
    });

    await service.handleCustomerMessage(makeTenant(), '5511999998888', 'tira a camisa');

    expect(conversation.cartLines).toHaveLength(0);
  });

  it('decrements (not removes) on a partial remove_from_cart', async () => {
    conversation.cartLines = [
      { variantId: 'v1', productId: 'p1', productName: 'Camisa X', sku: 's', priceRetail: 100, priceWholesale: null, minWholesaleQty: 1, imageUrl: null, quantity: 3, isOrder: false },
    ];
    chat.reply.mockResolvedValue({
      reply: 'Tirei 1!',
      actions: [{ type: 'remove_from_cart', variantId: 'v1', isOrder: false, quantity: 1 }],
    });

    await service.handleCustomerMessage(makeTenant(), '5511999998888', 'tira 1');

    expect(conversation.cartLines).toHaveLength(1);
    expect(conversation.cartLines[0].quantity).toBe(2);
  });

  describe('deterministic cart summary appended to the reply (found live: LLM narration can lie about cart contents)', () => {
    it('appends a real cart summary after an add_to_cart action, regardless of what the LLM narrated', async () => {
      chat.reply.mockResolvedValue({
        reply: 'Você agora tem 2 unidades! (isso está errado de propósito neste teste)',
        actions: [
          { type: 'add_to_cart', variantId: 'v1', productId: 'p1', productName: 'Camisa Real Madrid I 2024', sku: 'FUT-CRM-G', color: 'Padrão', size: 'G', priceRetail: 200, priceWholesale: null, minWholesaleQty: 1, imageUrl: null, quantity: 1, isOrder: false },
        ],
      });

      await service.handleCustomerMessage(makeTenant(), '5511999998888', 'quero a G');

      const [, , sentReply] = sender.sendText.mock.calls.at(-1)!;
      expect(sentReply).toContain('🛒 Carrinho atual:');
      expect(sentReply).toContain('1x Camisa Real Madrid I 2024 (G/Padrão)');
      expect(sentReply).toContain('Total: R$'); // deterministic total always appended, regardless of what the LLM said
    });

    it('appends "carrinho: vazio" after a remove_from_cart action that empties the cart, even if the LLM claimed an item remained', async () => {
      conversation.cartLines = [
        { variantId: 'v1', productId: 'p1', productName: 'Camisa Real Madrid I 2024', sku: 'FUT-CRM-G', priceRetail: 200, priceWholesale: null, minWholesaleQty: 1, imageUrl: null, quantity: 1, isOrder: false },
      ];
      chat.reply.mockResolvedValue({
        reply: 'Removi a outra, ainda ficou a G no carrinho (isso está errado de propósito neste teste)',
        actions: [{ type: 'remove_from_cart', variantId: 'v1', isOrder: false, quantity: null }],
      });

      await service.handleCustomerMessage(makeTenant(), '5511999998888', 'retire a outra');

      const [, , sentReply] = sender.sendText.mock.calls.at(-1)!;
      expect(sentReply).toContain('🛒 Carrinho: vazio.');
    });

    it('does not append a cart summary when no cart action happened this turn (pure Q&A)', async () => {
      chat.reply.mockResolvedValue({ reply: 'Sim, temos em estoque!', actions: [] });

      await service.handleCustomerMessage(makeTenant(), '5511999998888', 'tem em estoque?');

      const [, , sentReply] = sender.sendText.mock.calls.at(-1)!;
      expect(sentReply).toBe('Sim, temos em estoque!');
    });

    it('does not double up the cart summary when a confirm_order also fired in the same turn (tryCreateOrder reply already deterministic)', async () => {
      conversation.cartLines = [
        { variantId: 'v1', productId: 'p1', productName: 'Camisa X', sku: 's', priceRetail: 100, priceWholesale: null, minWholesaleQty: 1, imageUrl: null, quantity: 1, isOrder: false },
      ];
      chat.reply.mockResolvedValue({
        reply: 'Fechando!',
        actions: [{ type: 'confirm_order', name: 'Ana', shippingOption: 'standard' }],
      });
      orderDrafts.createPublic.mockResolvedValue({ sessionToken: 'tok-1' });
      orderDrafts.submitByToken.mockResolvedValue({ orderId: 'order-1' });
      orders.findOne.mockResolvedValue({ _id: 'order-1', number: 1, total: 100, warnings: [] });

      await service.handleCustomerMessage(makeTenant(), '5511999998888', 'confirma');

      const [, , sentReply] = sender.sendText.mock.calls.at(-1)!;
      expect(sentReply).not.toContain('🛒');
      expect(sentReply).toContain('Pedido #1 confirmado');
    });
  });

  it('does nothing (no reply generated, no send) when the conversation has aiEnabled: false', async () => {
    conversation.aiEnabled = false;

    await service.handleCustomerMessage(makeTenant(), '5511999998888', 'oi');

    expect(chat.reply).not.toHaveBeenCalled();
    expect(sender.sendText).not.toHaveBeenCalled();
    expect(conversations.appendTurnAndSave).not.toHaveBeenCalled();
  });

  it('logs and does not crash or send anything when ChatService.reply throws', async () => {
    chat.reply.mockRejectedValue(new Error('groq down'));

    await expect(service.handleCustomerMessage(makeTenant(), '5511999998888', 'oi')).resolves.toBeUndefined();

    expect(sender.sendText).not.toHaveBeenCalled();
    expect(conversations.appendTurnAndSave).not.toHaveBeenCalled();
  });

  it('does not touch cartLines for a lead_request action (already persisted inside ChatService itself)', async () => {
    chat.reply.mockResolvedValue({
      reply: 'Vou repassar pra loja!',
      actions: [{ type: 'lead_request', productDescription: 'camisa seleção', customerName: 'Ana', customerPhone: '11999998888' }],
    });

    await service.handleCustomerMessage(makeTenant(), '5511999998888', 'quero uma camisa da seleção');

    expect(conversation.cartLines).toHaveLength(0);
  });

  describe('confirm_order (Loop 11-C)', () => {
    beforeEach(() => {
      conversation.cartLines = [
        { variantId: 'v1', productId: 'p1', productName: 'Camisa Flamengo I 2024', sku: 'FUT-CFI-M', priceRetail: 299.9, priceWholesale: null, minWholesaleQty: 1, imageUrl: null, quantity: 1, isOrder: false },
      ];
    });

    it('creates a real order via OrderDraftsService (createPublic → patchByToken → submitByToken) and clears the cart', async () => {
      chat.reply.mockResolvedValue({
        reply: 'Fechando!',
        actions: [{ type: 'confirm_order', name: 'Ana', shippingOption: 'standard' }],
      });
      orderDrafts.createPublic.mockResolvedValue({ sessionToken: 'tok-1' });
      orderDrafts.patchByToken.mockResolvedValue(undefined);
      orderDrafts.submitByToken.mockResolvedValue({ orderId: 'order-1' });
      orders.findOne.mockResolvedValue({ _id: 'order-1', number: 45, total: 299.9, warnings: [] });

      await service.handleCustomerMessage(makeTenant(), '5511999998888', 'pode fechar');

      expect(orderDrafts.createPublic).toHaveBeenCalledWith('tenant-1', { waId: '5511999998888' });
      expect(orderDrafts.patchByToken).toHaveBeenCalledWith(
        'tenant-1',
        'tok-1',
        expect.objectContaining({
          lines: [{ variantId: 'v1', quantity: 1 }],
          shippingMethod: 'standard',
          metadata: { customer: { name: 'Ana', phone: '5511999998888' } },
        }),
        ['production'],
      );
      expect(orderDrafts.submitByToken).toHaveBeenCalledWith('tenant-1', 'tok-1', { payment: { method: 'manual' } });
      expect(conversation.cartLines).toHaveLength(0);
      expect(sender.sendText).toHaveBeenCalledWith(
        expect.anything(),
        '5511999998888',
        expect.stringContaining('Pedido #45 confirmado'),
      );
    });

    it('replies with a real order total, not whatever the LLM said', async () => {
      chat.reply.mockResolvedValue({
        reply: 'Fechado, valor mil reais!', // LLM lying / hallucinating a wrong total
        actions: [{ type: 'confirm_order', name: 'Ana', shippingOption: 'pickup' }],
      });
      orderDrafts.createPublic.mockResolvedValue({ sessionToken: 'tok-1' });
      orderDrafts.submitByToken.mockResolvedValue({ orderId: 'order-1' });
      orders.findOne.mockResolvedValue({ _id: 'order-1', number: 7, total: 299.9, warnings: [] });

      await service.handleCustomerMessage(makeTenant(), '5511999998888', 'confirma');

      const [, , sentReply] = sender.sendText.mock.calls.at(-1)!;
      expect(sentReply).toContain('R$');
      expect(sentReply).toContain('299,90');
      expect(sentReply).not.toContain('mil reais');
    });

    it('refuses to create an order when the persisted cart is empty, even if the LLM emits confirm_order', async () => {
      conversation.cartLines = [];
      chat.reply.mockResolvedValue({
        reply: 'ok',
        actions: [{ type: 'confirm_order', name: 'Ana', shippingOption: 'standard' }],
      });

      await service.handleCustomerMessage(makeTenant(), '5511999998888', 'confirma');

      expect(orderDrafts.createPublic).not.toHaveBeenCalled();
      expect(sender.sendText).toHaveBeenCalledWith(expect.anything(), '5511999998888', expect.stringContaining('carrinho está vazio'));
    });

    it('replies with a graceful apology (not a crash, not a raw error) when the draft pipeline throws (e.g. stock changed)', async () => {
      chat.reply.mockResolvedValue({
        reply: 'Fechando!',
        actions: [{ type: 'confirm_order', name: 'Ana', shippingOption: 'standard' }],
      });
      orderDrafts.createPublic.mockResolvedValue({ sessionToken: 'tok-1' });
      orderDrafts.patchByToken.mockRejectedValue(new Error('Estoque insuficiente para FUT-CFI-M: disponível 0, solicitado 1'));

      await expect(service.handleCustomerMessage(makeTenant(), '5511999998888', 'confirma')).resolves.toBeUndefined();

      expect(sender.sendText).toHaveBeenCalledWith(expect.anything(), '5511999998888', expect.stringContaining('não consegui fechar'));
      expect(conversations.appendTurnAndSave).toHaveBeenCalled();
    });
  });
});
