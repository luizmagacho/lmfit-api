import { Injectable, Logger } from '@nestjs/common';
import { ChatService, ChatAction, WhatsappShippingOption } from '../chat/chat.service';
import type { PublicChatDto } from '../chat/dto/public-chat.dto';
import { OrderDraftsService } from '../order-drafts/order-drafts.service';
import { OrdersService } from '../orders/orders.service';
import { TenantsService } from '../tenants/tenants.service';
import type { TenantDocument } from '../tenants/schemas/tenant.schema';
import type { WhatsappConversationCartLine, WhatsappConversationDocument } from './schemas/whatsapp-conversation.schema';
import { WhatsappConversationsService } from './whatsapp-conversations.service';
import { WhatsappSenderService } from './whatsapp-sender.service';

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Loop 11-B/11-C — leva o assistente de compras por IA que já roda no site (`ChatService`, o mesmo
 * motor do balãozinho "Abrir chat") pro WhatsApp, com a diferença que aqui a continuidade da
 * conversa vem de `WhatsappConversation` (persistida por `{tenantId, waId}`) em vez do `useState`
 * do navegador, e a IA pode fechar um pedido real a partir do carrinho persistido (Loop 11-C,
 * `confirm_order`) reaproveitando o MESMO pipeline de rascunho→pedido que o checkout do site e a
 * opção "Combinar no WhatsApp (Manual)" já usam (`OrderDraftsService`) — nada de validação de
 * estoque/preço/frete duplicada.
 */
@Injectable()
export class WhatsappChatService {
  private readonly log = new Logger(WhatsappChatService.name);

  constructor(
    private readonly conversations: WhatsappConversationsService,
    private readonly chat: ChatService,
    private readonly sender: WhatsappSenderService,
    private readonly tenants: TenantsService,
    private readonly orderDrafts: OrderDraftsService,
    private readonly orders: OrdersService,
  ) {}

  private applyAddToCart(cartLines: WhatsappConversationCartLine[], action: Extract<ChatAction, { type: 'add_to_cart' }>): void {
    const existing = cartLines.find((l) => l.variantId === action.variantId);
    if (existing) {
      existing.quantity += action.quantity;
      existing.isOrder = existing.isOrder || action.isOrder;
      return;
    }
    cartLines.push({
      variantId: action.variantId,
      productId: action.productId,
      productName: action.productName,
      sku: action.sku,
      color: action.color,
      size: action.size,
      priceRetail: action.priceRetail,
      priceWholesale: action.priceWholesale,
      minWholesaleQty: action.minWholesaleQty,
      imageUrl: action.imageUrl,
      quantity: action.quantity,
      isOrder: action.isOrder,
    } as WhatsappConversationCartLine);
  }

  private applyRemoveFromCart(
    cartLines: WhatsappConversationCartLine[],
    action: Extract<ChatAction, { type: 'remove_from_cart' }>,
  ): WhatsappConversationCartLine[] {
    const idx = cartLines.findIndex((l) => l.variantId === action.variantId);
    if (idx === -1) return cartLines;
    if (action.quantity === null) {
      cartLines.splice(idx, 1);
      return cartLines;
    }
    cartLines[idx].quantity -= action.quantity;
    if (cartLines[idx].quantity <= 0) cartLines.splice(idx, 1);
    return cartLines;
  }

  /** Resumo do carrinho SEMPRE gerado a partir do dado real persistido — nunca do texto que a IA
   *  gerou. Achado ao vivo (verificação manual pelo usuário): a LLM às vezes narra o carrinho
   *  errado ("agora você tem 2 unidades...") mesmo quando a ação em si foi validada certinho
   *  contra o carrinho real — o texto livre não tem a mesma garantia que as ações têm. Anexado à
   *  resposta sempre que uma ação de carrinho foi aplicada neste turno, pra o cliente nunca ficar
   *  na dúvida do que está de verdade no carrinho. */
  private formatCartSummary(cartLines: WhatsappConversationCartLine[]): string {
    if (!cartLines.length) return '🛒 Carrinho: vazio.';
    const lines = cartLines
      .map((l) => {
        const variant = [l.size, l.color].filter(Boolean).join('/');
        const label = variant ? `${l.productName} (${variant})` : l.productName;
        return `• ${l.quantity}x ${label} — ${currencyFormatter.format(l.priceRetail * l.quantity)}`;
      })
      .join('\n');
    const total = cartLines.reduce((sum, l) => sum + l.priceRetail * l.quantity, 0);
    return `🛒 Carrinho atual:\n${lines}\nTotal: ${currencyFormatter.format(total)}`;
  }

  /** Mesmos rótulos/valores padrão que `ShippingPicker.tsx` já usa no checkout do site
   *  (`DEFAULT_STANDARD_FEE`/`DEFAULT_EXPRESS_FEE` = 19.9/39.9) — a IA sempre cita a taxa REAL
   *  configurada pelo lojista, nunca inventa um valor. */
  private buildShippingOptions(tenant: TenantDocument, cartSubtotal: number): WhatsappShippingOption[] {
    const cfg = tenant.shippingConfig;
    const threshold = cfg?.freeAboveTotal;
    const free = Boolean(threshold && threshold > 0 && cartSubtotal >= threshold);
    return [
      { value: 'pickup', label: cfg?.pickupLabel || 'Retirada em Loja / Banca', fee: 0 },
      { value: 'standard', label: 'Entrega padrão', fee: free ? 0 : (cfg?.standardFee ?? 19.9) },
      { value: 'express', label: 'Entrega expressa', fee: free ? 0 : (cfg?.expressFee ?? 39.9) },
    ];
  }

  /** Cria o pedido de verdade a partir do carrinho persistido, reusando o MESMO pipeline
   *  rascunho→pedido do checkout real (`OrderDraftsService`) — a mesma revalidação de
   *  estoque/preço que qualquer outra superfície de criação de pedido já passa. Nunca confia no
   *  carrinho persistido como preço final: `patchByToken` recalcula tudo contra o catálogo real
   *  no instante da confirmação, podendo recusar se o estoque mudou desde o `add_to_cart`. */
  private async tryCreateOrder(
    tenant: TenantDocument,
    conversation: WhatsappConversationDocument,
    waId: string,
    action: Extract<ChatAction, { type: 'confirm_order' }>,
    features: string[],
  ): Promise<string> {
    if (!conversation.cartLines.length) {
      return 'Seu carrinho está vazio — me diga o que você quer antes de eu fechar o pedido.';
    }
    const tenantId = tenant._id.toString();
    try {
      const draft = await this.orderDrafts.createPublic(tenantId, { waId });
      await this.orderDrafts.patchByToken(
        tenantId,
        draft.sessionToken,
        {
          lines: conversation.cartLines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
          shippingMethod: action.shippingOption as 'pickup' | 'standard' | 'express',
          metadata: { customer: { name: action.name, phone: waId } },
        },
        features,
      );
      const { orderId } = await this.orderDrafts.submitByToken(tenantId, draft.sessionToken, {
        payment: { method: 'manual' },
      });
      const order = await this.orders.findOne(tenantId, orderId);
      conversation.cartLines = [] as unknown as WhatsappConversationCartLine[];
      const total = currencyFormatter.format(Number(order.total ?? 0));
      return `Pedido #${String(order.number ?? orderId)} confirmado! Total: ${total}. Nossa equipe vai entrar em contato pra combinar pagamento e entrega. Obrigado pela compra! 🎉`;
    } catch (e) {
      this.log.warn(`Falha ao criar pedido via WhatsApp pro tenant ${tenant.slug}, waId ${waId}: ${String(e)}`);
      return 'Poxa, não consegui fechar seu pedido agora — pode ser que o estoque tenha mudado. Pode conferir os itens e tentar confirmar de novo?';
    }
  }

  /** Ponto de entrada chamado por `InboundMessageProcessor` para números que NÃO estão na
   *  allowlist de staff (ou seja, clientes de verdade) — o pipeline de staff (ERP via
   *  `LlmService.parseIntent`) continua intocado, roda em paralelo pra números allowlisted. */
  async handleCustomerMessage(tenant: TenantDocument, waId: string, text: string): Promise<void> {
    const tenantId = tenant._id.toString();
    const conversation = await this.conversations.findOrCreate(tenantId, waId);
    // Trava de "humano assumiu a conversa" — staff pausa a IA numa conversa específica via
    // PATCH /internal/whatsapp/conversations/:waId (whatsapp-internal.controller.ts).
    if (!conversation.aiEnabled) return;
    const features = this.tenants.resolveFeatures(tenant);
    const cartSubtotal = conversation.cartLines.reduce((sum, l) => sum + l.priceRetail * l.quantity, 0);
    const shippingOptions = this.buildShippingOptions(tenant, cartSubtotal);

    const dto = {
      message: text,
      history: conversation.history.map((h) => ({ role: h.role, content: h.content })),
      cartLines: conversation.cartLines.map((l) => ({
        variantId: l.variantId,
        productName: l.productName,
        quantity: l.quantity,
        isOrder: l.isOrder,
      })),
    } as PublicChatDto;

    let reply: string;
    let actions: ChatAction[];
    try {
      ({ reply, actions } = await this.chat.reply(tenantId, dto, features, { shippingOptions }));
    } catch (e) {
      this.log.error(`Falha ao gerar resposta da IA pro tenant ${tenant.slug}, waId ${waId}`, e as Error);
      return;
    }

    let finalReply = reply;
    let cartWasModified = false;
    let orderWasConfirmed = false;
    for (const action of actions) {
      if (action.type === 'add_to_cart') {
        this.applyAddToCart(conversation.cartLines, action);
        cartWasModified = true;
      } else if (action.type === 'remove_from_cart') {
        this.applyRemoveFromCart(conversation.cartLines, action);
        cartWasModified = true;
      } else if (action.type === 'confirm_order') {
        finalReply = await this.tryCreateOrder(tenant, conversation, waId, action, features);
        orderWasConfirmed = true;
      }
      // lead_request já foi persistido dentro de ChatService.resolveActions — nada a fazer aqui.
    }
    // O resumo do pedido criado (ou a mensagem de erro) já é 100% determinístico — anexar o
    // resumo de carrinho ali também não faz sentido (carrinho já foi zerado ou nem existe erro de carrinho).
    if (cartWasModified && !orderWasConfirmed) {
      finalReply = `${finalReply}\n\n${this.formatCartSummary(conversation.cartLines)}`;
    }

    await this.conversations.appendTurnAndSave(conversation, text, finalReply);
    await this.sender.sendText(tenant, waId, finalReply);
  }
}
