import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
}
