import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { WhatsappSendersService } from './whatsapp-senders.service';

function chain<T>(value: T) {
  const c: any = { exec: jest.fn().mockResolvedValue(value) };
  c.populate = jest.fn().mockReturnValue(c);
  c.sort = jest.fn().mockReturnValue(c);
  c.lean = jest.fn().mockReturnValue(c);
  return c;
}

describe('WhatsappSendersService (Loop 12-B admin CRUD)', () => {
  const tenantId = new Types.ObjectId().toString();

  it('list scopes by tenant and populates the linked user', async () => {
    const items = [{ _id: new Types.ObjectId(), waId: '5511999998888' }];
    const model: any = { find: jest.fn().mockReturnValue(chain(items)) };
    const service = new WhatsappSendersService(model);

    const result = await service.list(tenantId);

    expect(model.find).toHaveBeenCalledWith({ tenantId: expect.any(Types.ObjectId) });
    expect(result).toBe(items);
  });

  it('create defaults allowed to true and converts linkedUserId to an ObjectId', async () => {
    const model: any = { create: jest.fn().mockResolvedValue({ _id: 'new-1' }) };
    const service = new WhatsappSendersService(model);
    const userId = new Types.ObjectId().toString();

    await service.create(tenantId, { waId: ' 5511999998888 ', label: 'Luiz', linkedUserId: userId });

    expect(model.create).toHaveBeenCalledWith({
      tenantId: expect.any(Types.ObjectId),
      waId: '5511999998888',
      label: 'Luiz',
      linkedUserId: expect.any(Types.ObjectId),
      allowed: true,
    });
  });

  it('create surfaces a duplicate waId as a clean ConflictException, not a raw Mongo error', async () => {
    const model: any = { create: jest.fn().mockRejectedValue({ code: 11000 }) };
    const service = new WhatsappSendersService(model);

    await expect(service.create(tenantId, { waId: '5511999998888' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('update only touches the fields actually provided', async () => {
    const model: any = { findOneAndUpdate: jest.fn().mockReturnValue(chain({ _id: 'x', allowed: false })) };
    const service = new WhatsappSendersService(model);

    await service.update(tenantId, 'sender-1', { allowed: false });

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'sender-1', tenantId: expect.any(Types.ObjectId) },
      { allowed: false },
      { new: true },
    );
  });

  it('update clears linkedUserId when given an empty string (unlink)', async () => {
    const model: any = { findOneAndUpdate: jest.fn().mockReturnValue(chain({ _id: 'x' })) };
    const service = new WhatsappSendersService(model);

    await service.update(tenantId, 'sender-1', { linkedUserId: '' });

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { linkedUserId: undefined },
      expect.anything(),
    );
  });

  it('update throws NotFoundException when the sender does not belong to this tenant', async () => {
    const model: any = { findOneAndUpdate: jest.fn().mockReturnValue(chain(null)) };
    const service = new WhatsappSendersService(model);

    await expect(service.update(tenantId, 'sender-1', { allowed: true })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove throws NotFoundException when nothing was deleted', async () => {
    const model: any = { deleteOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 0 }) }) };
    const service = new WhatsappSendersService(model);

    await expect(service.remove(tenantId, 'sender-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove scopes the delete by tenant so one tenant can never delete another tenant\'s sender', async () => {
    const model: any = { deleteOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 1 }) }) };
    const service = new WhatsappSendersService(model);

    await service.remove(tenantId, 'sender-1');

    expect(model.deleteOne).toHaveBeenCalledWith({ _id: 'sender-1', tenantId: expect.any(Types.ObjectId) });
  });
});
