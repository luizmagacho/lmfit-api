import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { CreateWhatsappSenderDto } from './dto/create-whatsapp-sender.dto';
import type { UpdateWhatsappSenderDto } from './dto/update-whatsapp-sender.dto';
import { WhatsAppSender } from './schemas/whatsapp-sender.schema';

@Injectable()
export class WhatsappSendersService {
  constructor(
    @InjectModel(WhatsAppSender.name)
    private readonly model: Model<WhatsAppSender>,
  ) {}

  async isAllowed(waId: string): Promise<boolean> {
    const doc = await this.model.findOne({ waId: waId.trim() }).lean().exec();
    return Boolean(doc?.allowed);
  }

  /** Loop 12-B — full record (incl. `linkedUserId`), needed to resolve which store location a
   *  staff member's dictated sale should deduct stock from. */
  async findByWaId(tenantId: string, waId: string) {
    return this.model
      .findOne({ tenantId: new Types.ObjectId(tenantId), waId: waId.trim() })
      .lean()
      .exec();
  }

  /** Admin UI — cadastro de vendedores autorizados a vender por WhatsApp. */
  async list(tenantId: string) {
    return this.model
      .find({ tenantId: new Types.ObjectId(tenantId) })
      .populate('linkedUserId', 'name email assignedLocationId')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async create(tenantId: string, dto: CreateWhatsappSenderDto) {
    try {
      return await this.model.create({
        tenantId: new Types.ObjectId(tenantId),
        waId: dto.waId.trim(),
        label: dto.label,
        linkedUserId: dto.linkedUserId ? new Types.ObjectId(dto.linkedUserId) : undefined,
        allowed: dto.allowed ?? true,
      });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) {
        throw new ConflictException('Esse número já está cadastrado.');
      }
      throw e;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateWhatsappSenderDto) {
    const update: Record<string, unknown> = {};
    if (dto.label !== undefined) update.label = dto.label;
    if (dto.allowed !== undefined) update.allowed = dto.allowed;
    if (dto.linkedUserId !== undefined) {
      update.linkedUserId = dto.linkedUserId ? new Types.ObjectId(dto.linkedUserId) : undefined;
    }
    const doc = await this.model
      .findOneAndUpdate({ _id: id, tenantId: new Types.ObjectId(tenantId) }, update, { new: true })
      .lean()
      .exec();
    if (!doc) throw new NotFoundException('Número não encontrado.');
    return doc;
  }

  async remove(tenantId: string, id: string) {
    const res = await this.model
      .deleteOne({ _id: id, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (res.deletedCount === 0) throw new NotFoundException('Número não encontrado.');
    return { ok: true };
  }
}
