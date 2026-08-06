import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { OrderDraft, OrderDraftDocument } from './schemas/order-draft.schema';
import { ProductVariant } from '../products/schemas/product-variant.schema';
import { Customer } from '../customers/schemas/customer.schema';
import { NotificationsService } from '../notifications/notifications.service';

const DEFAULT_ABANDONED_CART_HOURS = 3;

interface RecoveryItem {
  name: string;
  slug?: string;
  quantity: number;
}

/**
 * Loop 16 — e-mail-only (WhatsApp fica pra depois: precisaria da Graph API da Meta, que não existe
 * neste projeto). Molde de `low-stock.cron.ts` (dedup via campo próprio, checado antes de agir) +
 * `sync-cron.service.ts` (loop por-item com try/catch isolado, uma falha nunca derruba as outras).
 *
 * Achado importante: nem todo carrinho abandonado tem e-mail — quem só aplicou cupom na sacola
 * (`CartDrawer`'s `createDraft(phone)`) tem só `waId`, sem e-mail nenhum. Esses são contados e
 * logados separadamente (não silenciados) em vez de fingir que não existem.
 */
@Injectable()
export class AbandonedCartCron {
  private readonly log = new Logger(AbandonedCartCron.name);

  constructor(
    @InjectModel(OrderDraft.name) private readonly draftModel: Model<OrderDraftDocument>,
    @InjectModel(ProductVariant.name) private readonly variantModel: Model<ProductVariant>,
    @InjectModel(Customer.name) private readonly customerModel: Model<Customer>,
    private readonly notify: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async checkAbandonedCarts(): Promise<void> {
    const hours = Number(this.config.get<string>('ABANDONED_CART_HOURS') ?? DEFAULT_ABANDONED_CART_HOURS);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    const drafts = await this.draftModel
      .find({
        orderId: { $exists: false },
        abandonedNotifiedAt: { $exists: false },
        updatedAt: { $lte: cutoff },
        'lines.0': { $exists: true },
      })
      .exec();

    let emailed = 0;
    let skippedNoEmail = 0;

    for (const draft of drafts) {
      try {
        const email = await this.resolveEmail(draft);
        if (!email) {
          skippedNoEmail++;
          draft.abandonedNotifiedAt = new Date();
          await draft.save();
          continue;
        }
        const items = await this.buildRecoveryItems(draft);
        if (!items.length) {
          // Todas as linhas apontam pra variantes já excluídas — não há o que recuperar.
          draft.abandonedNotifiedAt = new Date();
          await draft.save();
          continue;
        }
        await this.sendRecoveryEmail(email, items);
        draft.abandonedNotifiedAt = new Date();
        await draft.save();
        emailed++;
      } catch (err: any) {
        // Não marca `abandonedNotifiedAt` num erro real de envio — deve tentar de novo na próxima
        // execução (diferente do magic-link, aqui não existe um recurso já criado a proteger).
        this.log.error(`Falha ao processar carrinho abandonado ${draft._id}: ${err.message}`);
      }
    }

    if (emailed || skippedNoEmail) {
      this.log.log(
        `Carrinhos abandonados: ${emailed} e-mail(s) enviado(s), ${skippedNoEmail} sem e-mail disponível (carry-over WhatsApp).`,
      );
    }
  }

  private async resolveEmail(draft: OrderDraftDocument): Promise<string | undefined> {
    const metaEmail = (draft.metadata as Record<string, any> | undefined)?.customer?.email;
    if (typeof metaEmail === 'string' && metaEmail.trim()) return metaEmail.trim();
    if (draft.customerId) {
      const customer = await this.customerModel.findById(draft.customerId).select('email').lean().exec();
      if (customer?.email) return customer.email;
    }
    return undefined;
  }

  private async buildRecoveryItems(draft: OrderDraftDocument): Promise<RecoveryItem[]> {
    const variantIds = draft.lines.map((l) => l.variantId);
    const variants = await this.variantModel
      .find({ _id: { $in: variantIds } })
      .populate('productId', 'name slug')
      .lean()
      .exec();
    const byId = new Map(variants.map((v) => [String(v._id), v]));

    const items: RecoveryItem[] = [];
    for (const line of draft.lines) {
      const variant = byId.get(String(line.variantId));
      const product = variant?.productId as { name?: string; slug?: string } | undefined;
      if (!product) continue;
      items.push({ name: product.name ?? 'Produto', slug: product.slug, quantity: line.quantity });
    }
    return items;
  }

  private async sendRecoveryEmail(email: string, items: RecoveryItem[]): Promise<void> {
    const base = this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000';
    const textLines = items
      .map((i) => `- ${i.name} x${i.quantity}${i.slug ? ` — ${base}/loja/p/${i.slug}` : ''}`)
      .join('\n');
    const htmlItems = items
      .map(
        (i) =>
          `<li>${i.name} × ${i.quantity}${i.slug ? ` — <a href="${base}/loja/p/${i.slug}">Ver produto</a>` : ''}</li>`,
      )
      .join('');

    await this.notify.sendEmail(
      email,
      'Você esqueceu itens na sua sacola',
      `Vimos que você deixou itens na sua sacola:\n\n${textLines}\n\nVolte pra loja: ${base}/loja`,
      `<p>Vimos que você deixou itens na sua sacola:</p><ul>${htmlItems}</ul><p><a href="${base}/loja">Voltar pra loja</a></p>`,
    );
  }
}
