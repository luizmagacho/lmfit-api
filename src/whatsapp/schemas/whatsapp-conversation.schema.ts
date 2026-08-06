import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WhatsappConversationDocument = HydratedDocument<WhatsappConversation>;

/** Espelha `ChatMessageDto` (`src/chat/dto/public-chat.dto.ts`) — mesma forma que o widget do site
 *  já manda pra `ChatService.reply()`, só que persistida aqui em vez de vir do `useState` do
 *  navegador (WhatsApp não tem sessão de navegador pra guardar isso). */
export class WhatsappConversationMessage {
  @Prop({ type: String, enum: ['user', 'assistant'], required: true }) role: 'user' | 'assistant';
  @Prop({ required: true, trim: true, maxlength: 2000 }) content: string;
}

/** Espelha `ChatCartAction` (`src/chat/chat.service.ts`) — a linha JÁ VEM validada contra
 *  catálogo/estoque reais no momento em que foi adicionada (nunca confia no que a LLM devolve).
 *  Guardar a forma rica (preço/sku/etc.), não só `ChatCartLineDto`, porque o Loop 11-C usa isso
 *  direto pra criar o pedido real sem precisar re-buscar o produto. */
export class WhatsappConversationCartLine {
  @Prop({ required: true, trim: true }) variantId: string;
  @Prop({ required: true, trim: true }) productId: string;
  @Prop({ required: true, trim: true }) productName: string;
  @Prop({ required: true, trim: true }) sku: string;
  @Prop({ trim: true }) color?: string;
  @Prop({ trim: true }) size?: string;
  @Prop({ required: true }) priceRetail: number;
  @Prop({ type: Number, default: null }) priceWholesale: number | null;
  @Prop({ required: true }) minWholesaleQty: number;
  @Prop({ type: String, default: null }) imageUrl: string | null;
  @Prop({ required: true }) quantity: number;
  @Prop({ default: false }) isOrder: boolean;
}

/**
 * Loop 11-B — continuidade de conversa por número de WhatsApp. O widget do site
 * (`ChatWidget.tsx`) guarda histórico+carrinho no `useState` do navegador e manda de volta a cada
 * request; aqui não existe navegador, então isso precisa ser persistido — uma linha por
 * `{tenantId, waId}`.
 */
@Schema({ timestamps: true })
export class WhatsappConversation {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  waId: string;

  @Prop({ type: [WhatsappConversationMessage], default: [] })
  history: WhatsappConversationMessage[];

  @Prop({ type: [WhatsappConversationCartLine], default: [] })
  cartLines: WhatsappConversationCartLine[];

  @Prop({ trim: true })
  customerName?: string;

  /** Loop 11-C — trava de "humano assume a conversa": staff pode desligar a IA pra este número
   *  específico sem precisar desligar `Tenant.whatsappAiEnabled` pra loja inteira. */
  @Prop({ default: true })
  aiEnabled: boolean;
}

export const WhatsappConversationSchema = SchemaFactory.createForClass(WhatsappConversation);
WhatsappConversationSchema.index({ tenantId: 1, waId: 1 }, { unique: true });
