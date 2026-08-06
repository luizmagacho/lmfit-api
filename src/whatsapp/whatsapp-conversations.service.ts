import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WhatsappConversation,
  WhatsappConversationDocument,
} from './schemas/whatsapp-conversation.schema';

/** Mesmo limite do `ChatWidget.tsx` (`MAX_HISTORY = 20`) — o histórico persistido aqui cumpre o
 *  mesmo papel que o `useState` do navegador cumpre lá, só que sobrevivendo entre mensagens. */
const MAX_HISTORY = 20;

@Injectable()
export class WhatsappConversationsService {
  constructor(
    @InjectModel(WhatsappConversation.name)
    private readonly model: Model<WhatsappConversation>,
  ) {}

  /** Upsert atômico — evita a corrida de duas mensagens quase simultâneas do mesmo número
   *  criando duas conversas (o índice único `{tenantId, waId}` já impediria o segundo `create()`,
   *  mas `findOneAndUpdate` com upsert evita o erro de duplicidade de propósito). */
  async findOrCreate(tenantId: string, waId: string): Promise<WhatsappConversationDocument> {
    const trimmedWaId = waId.trim();
    return this.model
      .findOneAndUpdate(
        { tenantId: new Types.ObjectId(tenantId), waId: trimmedWaId },
        { $setOnInsert: { tenantId: new Types.ObjectId(tenantId), waId: trimmedWaId } },
        { upsert: true, new: true },
      )
      .exec() as unknown as Promise<WhatsappConversationDocument>;
  }

  /** Aplica o novo turno (pergunta+resposta) ao histórico persistido, capado nas últimas
   *  `MAX_HISTORY` mensagens, e salva. Chamado depois que o carrinho já foi atualizado no próprio
   *  documento pelo chamador (mutação direta + este `save()` cobre os dois de uma vez). */
  async appendTurnAndSave(
    doc: WhatsappConversationDocument,
    userMessage: string,
    assistantReply: string,
  ): Promise<WhatsappConversationDocument> {
    doc.history.push({ role: 'user', content: userMessage } as WhatsappConversationDocument['history'][number]);
    doc.history.push({ role: 'assistant', content: assistantReply } as WhatsappConversationDocument['history'][number]);
    if (doc.history.length > MAX_HISTORY) {
      doc.history = doc.history.slice(doc.history.length - MAX_HISTORY) as WhatsappConversationDocument['history'];
    }
    await doc.save();
    return doc;
  }

  /** Loop 11-C — staff assume/devolve a conversa pra IA por número específico (não precisa
   *  desligar `Tenant.whatsappAiEnabled` pra loja inteira). Upsert de propósito — permite pausar
   *  preventivamente um número antes mesmo da primeira mensagem dele existir. */
  async setAiEnabled(tenantId: string, waId: string, aiEnabled: boolean): Promise<WhatsappConversationDocument> {
    const trimmedWaId = waId.trim();
    return this.model
      .findOneAndUpdate(
        { tenantId: new Types.ObjectId(tenantId), waId: trimmedWaId },
        {
          $set: { aiEnabled },
          $setOnInsert: { tenantId: new Types.ObjectId(tenantId), waId: trimmedWaId },
        },
        { upsert: true, new: true },
      )
      .exec() as unknown as Promise<WhatsappConversationDocument>;
  }
}
