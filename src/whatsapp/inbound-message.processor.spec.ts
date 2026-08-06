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
  const senders: any = { isAllowed: jest.fn() };
  const messages: any = { updateOne: jest.fn().mockResolvedValue(undefined) };
  const llm: any = { parseIntent: jest.fn() };
  const orders: any = { create: jest.fn() };
  const purchases: any = { create: jest.fn() };
  const customers: any = { findFirstByHint: jest.fn(), findByWaId: jest.fn() };
  const suppliers: any = { findFirstByHint: jest.fn() };
  const notify: any = { sendStaffEmail: jest.fn().mockResolvedValue(undefined) };
  const tenants: any = { findById: jest.fn() };
  const whatsappChat: any = { handleCustomerMessage: jest.fn().mockResolvedValue(undefined) };

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
  );

  return { processor, config, senders, messages, llm, orders, purchases, customers, suppliers, notify, tenants, whatsappChat };
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
