import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as Sentry from '@sentry/nestjs';
import { OrdersService } from '../orders/orders.service';
import { Payment, type PaymentDocument } from './schemas/payment.schema';
import { PaymentWebhookDispatcherService } from './payment-webhook-dispatcher.service';
import { TenantsService } from '../tenants/tenants.service';
import { AnalyticsService } from '../analytics/analytics.service';

const DEV_PIX_PLACEHOLDER =
  '00020126580014br.gov.bcb.pix0136126e573aa-c-8eae-47a8-b10a-e143f1c18af1520400005303986540510005802BR5925KIVONI_API_DEV_PIX6009SAO_PAULO62070503***6304ABCD';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: any,
    private readonly config: ConfigService,
    private readonly webhooks: PaymentWebhookDispatcherService,
    private readonly tenantsService: TenantsService,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * "Pix" na loja pública. A InfinitePay não expõe geração de BR Code Pix avulso (só o checkout
   * hospedado, que aceita Pix e cartão) — gerar nosso próprio QR exigiria implementar a spec EMV
   * do Bacen do zero e não teria confirmação automática sem uma conta PSP própria por trás dele,
   * contradizendo o objetivo do loop ("pedido vira pago sem ação da equipe"). Por isso: quando o
   * tenant tem InfinitePay real configurada, "pix" reusa o mesmo checkout hospedado real
   * (`buildInfinitePayCheckoutUrl`) — o comprador escolhe Pix na página deles, e o webhook já
   * distingue `capture_method: 'pix' | 'credit_card'`. Sem credenciais reais, cai no QR de
   * desenvolvimento local (`DEV_PIX_PLACEHOLDER`), inalterado — segue servindo dev/homologação.
   */
  async createPixPayment(tenantId: string, orderId: string, amount: number): Promise<PaymentDocument> {
    if (!Types.ObjectId.isValid(orderId)) {
      throw new BadRequestException('orderId inválido');
    }
    const ttlMin = Number(this.config.get<string>('PIX_EXPIRES_MINUTES') ?? '30');
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + (Number.isFinite(ttlMin) ? ttlMin : 30));

    const tenant = await this.tenantsService.findById(tenantId);
    const hasRealPsp = !!(tenant && tenant.infinitePayTag && tenant.infinitePayApiKey);

    const doc = await this.paymentModel.create({
      tenantId: new Types.ObjectId(tenantId),
      orderId: new Types.ObjectId(orderId),
      status: 'pending',
      method: 'pix',
      amount,
      expiresAt,
      ...(hasRealPsp
        ? {}
        : {
            qrCode: DEV_PIX_PLACEHOLDER,
            qrCodeImage: this.config.get<string>('PIX_DEV_QR_IMAGE')?.trim() || undefined,
          }),
    });

    if (hasRealPsp) {
      const checkoutUrl = await this.buildInfinitePayCheckoutUrl(tenant!, tenantId, orderId, doc);
      if (checkoutUrl) {
        doc.checkoutUrl = checkoutUrl;
      } else {
        // Credenciais configuradas mas a chamada real falhou (chave inválida, PSP fora do ar) —
        // cai no QR de dev em vez de deixar o pagamento sem QR nem link nenhum.
        doc.qrCode = DEV_PIX_PLACEHOLDER;
        doc.qrCodeImage = this.config.get<string>('PIX_DEV_QR_IMAGE')?.trim() || undefined;
      }
      await doc.save();
    }
    return doc;
  }

  async createInfinitePayPayment(tenantId: string, orderId: string, amount: number): Promise<PaymentDocument> {
    if (!Types.ObjectId.isValid(orderId)) {
      throw new BadRequestException('orderId inválido');
    }
    const doc = await this.paymentModel.create({
      tenantId: new Types.ObjectId(tenantId),
      orderId: new Types.ObjectId(orderId),
      status: 'pending',
      method: 'infinitepay',
      amount,
    });

    doc.checkoutUrl = `/checkout/payment-simulation?paymentId=${doc._id}`;

    const tenant = await this.tenantsService.findById(tenantId);
    if (tenant && tenant.infinitePayTag && tenant.infinitePayApiKey) {
      const checkoutUrl = await this.buildInfinitePayCheckoutUrl(tenant, tenantId, orderId, doc);
      if (checkoutUrl) doc.checkoutUrl = checkoutUrl;
    }

    await doc.save();
    return doc;
  }

  /**
   * Chama a API real da InfinitePay (`POST /links`) para gerar o checkout hospedado (Pix + cartão
   * até 12x). Compartilhado entre `createPixPayment` e `createInfinitePayPayment` — mesma
   * integração, só muda o que o comprador escolhe na página deles. Retorna `undefined` em caso de
   * falha (rede, credencial inválida) para que o chamador mantenha seu fallback local.
   */
  private async buildInfinitePayCheckoutUrl(
    tenant: { infinitePayTag?: string; infinitePayApiKey?: string },
    tenantId: string,
    orderId: string,
    doc: PaymentDocument,
  ): Promise<string | undefined> {
    try {
      const order = (await this.orders.findOne(tenantId, orderId)) as any;
      if (!order) return undefined;

      const items = [];
      const variantModel = this.paymentModel.db.model('ProductVariant');
      for (const line of order.lines || []) {
        let desc = line.description || 'Produto';
        if (!line.description) {
          const variant = (await variantModel.findById(line.variantId).lean().exec()) as any;
          if (variant) {
            desc = variant.sku || 'Produto';
          }
        }
        items.push({
          quantity: line.quantity,
          price: Math.round(line.unitPrice * 100), // Centavos
          description: desc,
        });
      }

      let customerData: any = undefined;
      if (order.customerId) {
        const customerModel = this.paymentModel.db.model('Customer');
        const customer = (await customerModel.findById(order.customerId).lean().exec()) as any;
        if (customer) {
          customerData = {
            name: customer.name,
            email: customer.email || undefined,
            phone_number: customer.phone || undefined,
          };
        }
      }

      const publicApiBaseUrl = this.config.get<string>('PUBLIC_API_BASE_URL') || 'http://localhost:4000';
      const webAdminBaseUrl = this.config.get<string>('WEB_ADMIN_BASE_URL') || 'http://localhost:3000';
      const handle = tenant.infinitePayTag!.trim().replace(/^\$/, '');

      // O redirect pós-pagamento aponta para /pedido/confirmado (Loop 1); /pedido/novo é o
      // harness de dev retirado — deixá-lo aqui mandaria um comprador real pra uma tela morta.
      const sessionToken = order.reference?.startsWith('draft:') ? order.reference.split(':')[1] : '';
      const redirectUrl = sessionToken
        ? `${webAdminBaseUrl}/pedido/confirmado?token=${encodeURIComponent(sessionToken)}&paymentId=${encodeURIComponent(String(doc._id))}`
        : `${webAdminBaseUrl}/pedido/confirmado?paymentId=${encodeURIComponent(String(doc._id))}`;

      // Segredo embutido na query do webhook_url: a InfinitePay reenvia essa URL exatamente como
      // fornecida, então o controller consegue validar a origem sem depender de um header de
      // assinatura que a API pode não expor (ver Decisions do loop-02 spec).
      const webhookSecret = this.config.get<string>('PAYMENT_WEBHOOK_SECRET')?.trim();
      const webhookUrl = new URL(`${publicApiBaseUrl}/public/payments/infinitepay-webhook`);
      if (webhookSecret) webhookUrl.searchParams.set('secret', webhookSecret);

      const payload = {
        handle,
        order_nsu: String(doc._id),
        redirect_url: redirectUrl,
        webhook_url: webhookUrl.toString(),
        items,
        customer: customerData,
      };

      const response = await fetch('https://api.checkout.infinitepay.io/links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tenant.infinitePayApiKey!.trim()}`,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const resJson = (await response.json()) as any;
        if (resJson && resJson.url) return resJson.url as string;
        return undefined;
      }
      const errText = await response.text();
      console.error('InfinitePay Link creation failed with status:', response.status);
      console.error('InfinitePay Link error response:', errText);
      Sentry.captureMessage('InfinitePay checkout link creation failed', {
        level: 'error',
        tags: { tenantId, orderId, status: String(response.status) },
        extra: { errText },
      });
      return undefined;
    } catch (err) {
      console.error('Error building InfinitePay checkout link:', err);
      Sentry.captureException(err, { tags: { tenantId, orderId, scope: 'infinitepay-checkout-link' } });
      return undefined;
    }
  }

  async confirmInfinitePayPaymentPaid(
    paymentId: string,
    transactionNsu?: string,
    captureMethod?: string,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(paymentId)) throw new NotFoundException();
    const p = await this.paymentModel.findById(paymentId).exec();
    if (!p) throw new NotFoundException();
    if (p.status !== 'pending') {
      throw new BadRequestException('Pagamento não está pendente');
    }
    if (transactionNsu) p.transactionNsu = transactionNsu;
    if (captureMethod) p.captureMethod = captureMethod;
    await p.save();

    const orderId = String(p.orderId);
    await this.orders.update(p.tenantId.toString(), orderId, { status: 'completed' }, undefined);
  }

  async findPublicStatusById(id: string): Promise<{ status: string; amount?: number; method?: string }> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const p = await this.paymentModel.findById(id).select('status amount method').lean().exec();
    if (!p) throw new NotFoundException();
    return { status: p.status, amount: p.amount, method: p.method };
  }

  /** Confirma pagamento (Pix ou InfinitePay): pedido → `completed` (estoque via OrdersService) e pagamento → `paid`. */
  async confirmPixPaymentPaid(paymentId: string): Promise<void> {
    if (!Types.ObjectId.isValid(paymentId)) throw new NotFoundException();
    const p = await this.paymentModel.findById(paymentId).exec();
    if (!p) throw new NotFoundException();
    if (p.status !== 'pending') {
      throw new BadRequestException('Pagamento não está pendente');
    }
    const orderId = String(p.orderId);
    await this.orders.update(p.tenantId.toString(), orderId, { status: 'completed' }, undefined);
  }

  async markExpiredIfDue(paymentId: string): Promise<void> {
    const p = await this.paymentModel.findById(paymentId).exec();
    if (!p || p.status !== 'pending') return;
    if (!p.expiresAt || p.expiresAt >= new Date()) return;
    p.status = 'expired';
    await p.save();
    await this.webhooks.dispatchPaymentEvent('payment.expired', {
      paymentId: String(p._id),
      orderId: String(p.orderId),
      status: 'expired',
      amount: p.amount,
      tenantId: String(p.tenantId),
    });
  }

  async syncPaymentPaidForOrder(tenantId: string, orderId: Types.ObjectId): Promise<void> {
    await this.paymentModel
      .updateMany(
        { tenantId: new Types.ObjectId(tenantId), orderId, status: 'pending' },
        { $set: { status: 'paid', paidAt: new Date() } },
      )
      .exec();
    const one = await this.paymentModel
      .findOne({ tenantId: new Types.ObjectId(tenantId), orderId, status: 'paid' })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    if (one) {
      await this.webhooks.dispatchPaymentEvent('payment.paid', {
        paymentId: String(one._id),
        orderId: String(orderId),
        status: 'paid',
        amount: one.amount,
        paidAt: one.paidAt ? new Date(one.paidAt).toISOString() : undefined,
        tenantId,
      });
      // Best-effort, nunca bloqueia a confirmação do pagamento: dispara o evento de compra pros
      // pixels configurados pelo tenant (Meta/GA4/TikTok) — este é o único ponto do backend por
      // onde todo pagamento realmente confirmado passa (Pix, InfinitePay, dev-confirm).
      this.analytics
        .trackPurchase(tenantId, { orderId: String(orderId), amount: one.amount })
        .catch(() => undefined);
    }
  }

  async cancelPendingForOrder(tenantId: string, orderId: Types.ObjectId): Promise<void> {
    const pending = await this.paymentModel
      .find({ tenantId: new Types.ObjectId(tenantId), orderId, status: 'pending' })
      .lean()
      .exec();
    if (!pending.length) return;
    await this.paymentModel
      .updateMany({ tenantId: new Types.ObjectId(tenantId), orderId, status: 'pending' }, { $set: { status: 'cancelled' } })
      .exec();
    for (const pay of pending) {
      await this.webhooks.dispatchPaymentEvent('payment.refunded', {
        paymentId: String(pay._id),
        orderId: String(orderId),
        status: 'cancelled',
        amount: pay.amount,
        tenantId,
      });
    }
  }

  // Admin / Staff CRUD operations
  async findAll(tenantId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const filter = { tenantId: new Types.ObjectId(tenantId) };
    const [items, total] = await Promise.all([
      this.paymentModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.paymentModel.countDocuments(filter).exec(),
    ]);
    return { items, total, page, limit };
  }

  async findOne(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.paymentModel
      .findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) })
      .lean()
      .exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async remove(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const res = await this.paymentModel
      .findOneAndDelete({ _id: id, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!res) throw new NotFoundException();
    return { deleted: true };
  }
}
