import { Types } from 'mongoose';
import { WhatsappConversationsService } from './whatsapp-conversations.service';

function chain<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

describe('WhatsappConversationsService', () => {
  const tenantId = new Types.ObjectId().toString();
  const waId = '5511999998888';

  it('findOrCreate upserts atomically with $setOnInsert, never overwriting an existing doc', async () => {
    const model: any = { findOneAndUpdate: jest.fn() };
    const existing = { _id: new Types.ObjectId(), tenantId, waId, history: [], cartLines: [] };
    model.findOneAndUpdate.mockReturnValue(chain(existing));
    const service = new WhatsappConversationsService(model);

    const doc = await service.findOrCreate(tenantId, ` ${waId} `);

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { tenantId: expect.any(Types.ObjectId), waId },
      { $setOnInsert: { tenantId: expect.any(Types.ObjectId), waId } },
      { upsert: true, new: true },
    );
    expect(doc).toBe(existing);
  });

  it('appendTurnAndSave pushes a user+assistant turn and saves', async () => {
    const model: any = {};
    const service = new WhatsappConversationsService(model);
    const doc: any = { history: [], save: jest.fn().mockResolvedValue(undefined) };

    await service.appendTurnAndSave(doc, 'Oi, tem camisa M?', 'Temos sim!');

    expect(doc.history).toEqual([
      { role: 'user', content: 'Oi, tem camisa M?' },
      { role: 'assistant', content: 'Temos sim!' },
    ]);
    expect(doc.save).toHaveBeenCalledTimes(1);
  });

  it('appendTurnAndSave caps history at the last 20 messages', async () => {
    const model: any = {};
    const service = new WhatsappConversationsService(model);
    const doc: any = {
      history: Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `msg-${i}` })),
      save: jest.fn().mockResolvedValue(undefined),
    };

    await service.appendTurnAndSave(doc, 'nova pergunta', 'nova resposta');

    expect(doc.history).toHaveLength(20);
    expect(doc.history[0]).toEqual({ role: 'user', content: 'msg-2' });
    expect(doc.history.at(-1)).toEqual({ role: 'assistant', content: 'nova resposta' });
  });
});
