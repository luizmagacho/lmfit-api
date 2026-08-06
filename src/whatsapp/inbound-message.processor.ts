import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';
import { CatalogService } from '../catalog/catalog.service';
import { CustomersService } from '../customers/customers.service';
import { LlmService } from '../llm/llm.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { PurchasesService } from '../purchases/purchases.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { TenantsService } from '../tenants/tenants.service';
import { UsersService } from '../users/users.service';
import { resolveProductHint } from './product-hint-resolver';
import type { WhatsAppMessage } from './schemas/whatsapp-message.schema';
import { WhatsappChatService } from './whatsapp-chat.service';
import { WhatsappMediaService } from './whatsapp-media.service';
import { WhatsappMessagesService } from './whatsapp-messages.service';
import { WhatsappSenderService } from './whatsapp-sender.service';
import { WhatsappSendersService } from './whatsapp-senders.service';

const PAYMENT_LABELS: Record<'pix' | 'cash' | 'card', string> = {
  pix: 'Pix',
  cash: 'Dinheiro',
  card: 'Cartão',
};

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

@Injectable()
export class InboundMessageProcessor {
  private readonly log = new Logger(InboundMessageProcessor.name);

  constructor(
    private readonly config: ConfigService,
    private readonly senders: WhatsappSendersService,
    private readonly messages: WhatsappMessagesService,
    private readonly llm: LlmService,
    private readonly orders: OrdersService,
    private readonly purchases: PurchasesService,
    private readonly customers: CustomersService,
    private readonly suppliers: SuppliersService,
    private readonly notify: NotificationsService,
    private readonly tenants: TenantsService,
    private readonly whatsappChat: WhatsappChatService,
    private readonly media: WhatsappMediaService,
    private readonly catalog: CatalogService,
    private readonly users: UsersService,
    private readonly sender: WhatsappSenderService,
  ) {}

  async process(doc: HydratedDocument<WhatsAppMessage>): Promise<void> {
    const wamid = doc.wamid;
    const from = doc.fromWaId;
    let text = doc.textBody ?? '';

    // Loop 12-A — venda/compra ditada por voz: baixa o áudio real (a Meta só manda um ID de
    // mídia) e transcreve ANTES de decidir se a mensagem está vazia. Dali em diante o resto do
    // pipeline trata o texto transcrito exatamente como se tivesse sido digitado.
    if (!text.trim() && doc.audioMediaId) {
      const tenant = await this.tenants.findById(doc.tenantId.toString()).catch(() => null);
      if (!tenant) {
        await this.messages.updateOne(wamid, { processingStatus: 'failed', error: 'tenant_not_found' });
        return;
      }
      const audio = await this.media.downloadAudio(tenant, doc.audioMediaId);
      if (!audio) {
        await this.messages.updateOne(wamid, { processingStatus: 'failed', error: 'audio_download_failed' });
        return;
      }
      try {
        text = await this.llm.transcribeAudio(audio, doc.audioMimeType ?? 'audio/ogg');
      } catch (e) {
        this.log.error(e);
        await this.messages.updateOne(wamid, { processingStatus: 'failed', error: `transcription_failed: ${String(e)}` });
        return;
      }
      await this.messages.updateOne(wamid, { textBody: text });
    }

    if (!text.trim()) {
      await this.messages.updateOne(wamid, {
        processingStatus: 'escalated',
        error: 'empty_text',
      });
      return;
    }

    const requireAllow =
      this.config.get<string>('WHATSAPP_REQUIRE_ALLOWLIST') !== 'false';
    if (requireAllow) {
      const ok = await this.senders.isAllowed(from);
      if (!ok) {
        // Loop 11-B — número fora da allowlist de staff quase sempre é um CLIENTE de verdade, não
        // alguém tentando (mal) usar a automação de ERP. Se o tenant ligou a IA, responde o
        // cliente de verdade em vez de só mandar um e-mail interno que ele nunca vê.
        const tenant = await this.tenants.findById(doc.tenantId.toString()).catch(() => null);
        if (tenant?.whatsappAiEnabled) {
          await this.messages.updateOne(wamid, { processingStatus: 'ai_replied' });
          await this.whatsappChat.handleCustomerMessage(tenant, from, text);
          return;
        }
        await this.messages.updateOne(wamid, {
          processingStatus: 'escalated',
          error: 'sender_not_allowlisted',
        });
        await this.notify
          .sendStaffEmail(
            `[LM FIT] WhatsApp não autorizado`,
            `wa_id=${from}\nTexto: ${text}`,
          )
          .catch(() => undefined);
        return;
      }
    }

    let parsed;
    try {
      parsed = await this.llm.parseIntent(text);
    } catch (e) {
      this.log.error(e);
      await this.messages.updateOne(wamid, {
        processingStatus: 'failed',
        error: String(e),
      });
      await this.notify
        .sendStaffEmail(`[LM FIT] Falha Gemini`, `wa_id=${from}\n${String(e)}`)
        .catch(() => undefined);
      return;
    }

    await this.messages.updateOne(wamid, {
      processingStatus: 'parsed',
      geminiRaw: parsed as unknown as Record<string, unknown>,
    });

    if (
      parsed.confidence < 0.75 ||
      parsed.needs_clarification ||
      parsed.intent === 'UNKNOWN'
    ) {
      await this.messages.updateOne(wamid, {
        processingStatus: 'escalated',
        error: 'low_confidence_or_clarification',
      });
      await this.notify
        .sendStaffEmail(
          `[LM FIT] WhatsApp precisa revisão`,
          `wa_id=${from}\nConfiança: ${parsed.confidence}\nJSON: ${JSON.stringify(parsed)}`,
        )
        .catch(() => undefined);
      return;
    }

    if (parsed.intent === 'CREATE_PURCHASE') {
      let supplierId = parsed.entities.supplierId;
      if (!supplierId && parsed.entities.supplierHint) {
        const s = await this.suppliers.findFirstByHint(
          doc.tenantId.toString(),
          parsed.entities.supplierHint,
        );
        supplierId = s?._id ? String(s._id) : undefined;
      }
      if (!supplierId) {
        await this.messages.updateOne(wamid, {
          processingStatus: 'escalated',
          error: 'missing_supplier',
        });
        return;
      }
      const purchase = await this.purchases.create(doc.tenantId.toString(), {
        supplierId,
        status: (parsed.entities.purchaseStatus as any) ?? 'interest',
        reference: parsed.entities.reference,
        total: parsed.entities.total ?? 0,
        notes: parsed.entities.notes,
      });
      await this.messages.updateOne(wamid, {
        processingStatus: 'auto_posted',
        linkedPurchaseId: purchase._id as Types.ObjectId,
      });
      const web = this.config.get<string>('WEB_ADMIN_BASE_URL') ?? '';
      await this.notify
        .sendStaffEmail(
          `[LM FIT] Compra via WhatsApp`,
          `ID: ${String(purchase._id)}\n${web}/purchases`,
        )
        .catch(() => undefined);
      return;
    }

    if (parsed.intent === 'CREATE_ORDER') {
      await this.handleCreateOrder(doc, wamid, from, text, parsed);
    }
  }

  /**
   * Loop 12-B — vendedor dictando uma venda que já aconteceu ("vendi uma camisa X tamanho G em
   * dinheiro"), por voz ou texto. Diferente de `CREATE_PURCHASE`, isso precisa dar baixa de
   * estoque de verdade — reaproveita `OrdersService.syncBatch`, o MESMO caminho atômico e
   * idempotente já usado pelo PDV físico, em vez de `orders.create()` (que só desconta estoque
   * quando o status já chega como 'shipped'/'completed', nunca o caso aqui). `wamid` vira o
   * `clientSaleId` — reenviar a mesma mensagem nunca duplica a venda.
   */
  private async handleCreateOrder(
    doc: HydratedDocument<WhatsAppMessage>,
    wamid: string,
    from: string,
    text: string,
    parsed: Awaited<ReturnType<LlmService['parseIntent']>>,
  ): Promise<void> {
    const tenantId = doc.tenantId.toString();
    const tenant = await this.tenants.findById(tenantId).catch(() => null);
    if (!tenant) {
      await this.messages.updateOne(wamid, { processingStatus: 'failed', error: 'tenant_not_found' });
      return;
    }

    // Baixa de estoque é sempre por local físico — sem um vendedor vinculado a uma loja, nunca
    // adivinha de qual local tirar o item; escalona pra alguém resolver manualmente.
    const sender = await this.senders.findByWaId(tenantId, from);
    const staffUser = sender?.linkedUserId
      ? await this.users.findById(tenantId, String(sender.linkedUserId)).catch(() => null)
      : null;
    const locationId = staffUser?.assignedLocationId ? String(staffUser.assignedLocationId) : undefined;
    if (!locationId) {
      await this.messages.updateOne(wamid, { processingStatus: 'escalated', error: 'missing_location' });
      await this.notify
        .sendStaffEmail(
          `[LM FIT] Venda por WhatsApp sem loja definida`,
          `wa_id=${from}\nTexto: ${text}\nEsse número precisa de um usuário vinculado com loja/local atribuído em Usuários para vender por WhatsApp.`,
        )
        .catch(() => undefined);
      return;
    }

    let customerId = parsed.entities.customerId;
    if (!customerId && parsed.entities.customerHint) {
      const c = await this.customers.findFirstByHint(tenantId, parsed.entities.customerHint);
      customerId = c?._id ? String(c._id) : undefined;
    }
    if (!customerId) {
      const waCustomer = await this.customers.findByWaId(tenantId, from);
      if (waCustomer?._id) customerId = String(waCustomer._id);
    }
    if (!customerId) {
      // Venda presencial dictada por voz raramente vem com nome de cliente — cai no
      // "Consumidor Final" em vez de travar a venda esperando um dado que ninguém vai dar.
      const walkIn = await this.customers.getOrCreateWalkIn(tenantId);
      customerId = String(walkIn._id);
    }

    const rawLines = parsed.entities.lines ?? [];
    if (!rawLines.length) {
      await this.messages.updateOne(wamid, { processingStatus: 'escalated', error: 'missing_lines' });
      return;
    }

    const { items: catalogItems } = await this.catalog.listProducts(tenantId, { page: 1, limit: 1000 } as any);
    const resolvedLines: Array<{ variantId: string; quantity: number; unitPrice: number }> = [];
    const summaryParts: string[] = [];
    for (const l of rawLines) {
      if (!l.description) {
        await this.messages.updateOne(wamid, { processingStatus: 'escalated', error: 'invalid_order_lines' });
        return;
      }
      const resolved = resolveProductHint(catalogItems as Record<string, unknown>[], l.description, l.size, l.color);
      if (!resolved) {
        await this.messages.updateOne(wamid, {
          processingStatus: 'escalated',
          error: `product_not_found: ${l.description}${l.size ? ` (${l.size})` : ''}`,
        });
        await this.notify
          .sendStaffEmail(
            `[LM FIT] Venda por WhatsApp — produto não identificado`,
            `wa_id=${from}\nTexto: ${text}\nNão consegui identificar com certeza "${l.description}"${l.size ? ` tamanho ${l.size}` : ''} no catálogo — nada foi lançado, lance manualmente.`,
          )
          .catch(() => undefined);
        return;
      }
      const quantity = Math.max(1, Math.floor(Number(l.qty) || 1));
      resolvedLines.push({ variantId: resolved.variantId, quantity, unitPrice: resolved.priceRetail });
      summaryParts.push(
        `${quantity}x ${resolved.productName}${resolved.size ? ` (${resolved.size})` : ''} — ${formatBRL(resolved.priceRetail * quantity)}`,
      );
    }

    const paymentMethod = parsed.entities.paymentMethod ?? 'cash';
    const total = resolvedLines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

    let syncResult;
    try {
      [syncResult] = await this.orders.syncBatch(
        tenantId,
        locationId,
        [
          {
            clientSaleId: wamid,
            customerId,
            paymentMethod,
            notes: parsed.entities.notes,
            lines: resolvedLines,
          },
        ],
        sender?.linkedUserId ? String(sender.linkedUserId) : undefined,
      );
    } catch (e) {
      this.log.error(e);
      await this.messages.updateOne(wamid, { processingStatus: 'failed', error: String(e) });
      return;
    }

    await this.messages.updateOne(wamid, {
      processingStatus: 'auto_posted',
      linkedOrderId: new Types.ObjectId(syncResult.orderId),
    });

    // Confirmação deliberadamente 100% determinística (nunca texto livre da IA) — o vendedor
    // precisa poder confiar cegamente no que aparece aqui: produto, preço e pagamento exatamente
    // como ficaram gravados, não como o modelo "acha" que entendeu.
    const statusNote =
      syncResult.status === 'partial_backorder'
        ? '\n⚠️ Estoque insuficiente para parte da venda — o restante virou encomenda.'
        : '';
    const confirmMsg = `✅ Venda #${syncResult.orderNumber} registrada!\n${summaryParts.join('\n')}\nTotal: ${formatBRL(total)}\nPagamento: ${PAYMENT_LABELS[paymentMethod]}${statusNote}`;
    await this.sender.sendText(tenant, from, confirmMsg).catch(() => undefined);

    const web = this.config.get<string>('WEB_ADMIN_BASE_URL') ?? '';
    await this.notify
      .sendStaffEmail(`[LM FIT] Venda via WhatsApp`, `ID: ${syncResult.orderId}\n${web}/orders`)
      .catch(() => undefined);
  }
}
