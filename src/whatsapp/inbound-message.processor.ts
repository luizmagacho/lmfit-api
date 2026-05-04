import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';
import { CustomersService } from '../customers/customers.service';
import { GeminiService } from '../gemini/gemini.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { PurchasesService } from '../purchases/purchases.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import type { WhatsAppMessage } from './schemas/whatsapp-message.schema';
import { WhatsappMessagesService } from './whatsapp-messages.service';
import { WhatsappSendersService } from './whatsapp-senders.service';

@Injectable()
export class InboundMessageProcessor {
  private readonly log = new Logger(InboundMessageProcessor.name);

  constructor(
    private readonly config: ConfigService,
    private readonly senders: WhatsappSendersService,
    private readonly messages: WhatsappMessagesService,
    private readonly gemini: GeminiService,
    private readonly orders: OrdersService,
    private readonly purchases: PurchasesService,
    private readonly customers: CustomersService,
    private readonly suppliers: SuppliersService,
    private readonly notify: NotificationsService,
  ) {}

  async process(doc: HydratedDocument<WhatsAppMessage>): Promise<void> {
    const wamid = doc.wamid;
    const from = doc.fromWaId;
    const text = doc.textBody ?? '';
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
      parsed = await this.gemini.parseIntent(text);
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
      const purchase = await this.purchases.create({
        supplierId,
        status: parsed.entities.purchaseStatus ?? 'pending',
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
      let customerId = parsed.entities.customerId;
      if (!customerId && parsed.entities.customerHint) {
        const c = await this.customers.findFirstByHint(
          parsed.entities.customerHint,
        );
        customerId = c?._id ? String(c._id) : undefined;
      }
      const waCustomer = await this.customers.findByWaId(from);
      if (!customerId && waCustomer?._id) {
        customerId = String(waCustomer._id);
      }
      if (!customerId) {
        await this.messages.updateOne(wamid, {
          processingStatus: 'escalated',
          error: 'missing_customer',
        });
        return;
      }
      const lines = parsed.entities.lines ?? [];
      if (lines.length) {
        for (const l of lines) {
          if (!l.variantId || !l.qty || l.unitPrice === undefined) {
            await this.messages.updateOne(wamid, {
              processingStatus: 'escalated',
              error: 'invalid_order_lines',
            });
            return;
          }
        }
      }
      const order = await this.orders.create({
        customerId,
        status: parsed.entities.orderStatus ?? 'open',
        reference: parsed.entities.reference,
        notes: parsed.entities.notes,
        total: parsed.entities.total,
        lines: lines.length
          ? lines.map((l) => ({
              variantId: l.variantId!,
              quantity: l.qty!,
              unitPrice: l.unitPrice!,
              description: l.description,
            }))
          : undefined,
      });
      await this.messages.updateOne(wamid, {
        processingStatus: 'auto_posted',
        linkedOrderId: order._id as Types.ObjectId,
      });
      const web = this.config.get<string>('WEB_ADMIN_BASE_URL') ?? '';
      await this.notify
        .sendStaffEmail(
          `[LM FIT] Pedido via WhatsApp`,
          `ID: ${String(order._id)}\n${web}/orders`,
        )
        .catch(() => undefined);
    }
  }
}
