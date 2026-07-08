import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { skipFromPage } from '../common/dto/pagination-query.dto';
import { WhatsAppMessage } from './schemas/whatsapp-message.schema';

@Injectable()
export class WhatsappMessagesService {
  constructor(
    @InjectModel(WhatsAppMessage.name)
    private readonly model: Model<WhatsAppMessage>,
  ) {}

  async findByWamid(wamid: string) {
    return this.model.findOne({ wamid }).lean().exec();
  }

  async createInbound(input: {
    tenantId: string;
    wamid: string;
    fromWaId: string;
    type: string;
    textBody?: string;
    rawPayload: Record<string, unknown>;
  }) {
    try {
      return await this.model.create({
        ...input,
        processingStatus: 'received',
      });
    } catch (e: unknown) {
      const code = (e as { code?: number })?.code;
      if (code === 11000) return null;
      throw e;
    }
  }

  async updateOne(
    wamid: string,
    patch: Partial<
      Pick<
        WhatsAppMessage,
        | 'processingStatus'
        | 'geminiRaw'
        | 'linkedOrderId'
        | 'linkedPurchaseId'
        | 'error'
      >
    >,
  ) {
    await this.model.updateOne({ wamid }, patch).exec();
  }

  async listEscalations(page: number, limit: number) {
    const skip = skipFromPage(page, limit);
    const q = { processingStatus: { $in: ['escalated', 'failed'] as const } };
    const [items, total] = await Promise.all([
      this.model.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.model.countDocuments(q).exec(),
    ]);
    return { items, total, page, limit };
  }

  async listAll(page: number, limit: number) {
    const skip = skipFromPage(page, limit);
    const [items, total] = await Promise.all([
      this.model.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.model.countDocuments({}).exec(),
    ]);
    return { items, total, page, limit };
  }
}
