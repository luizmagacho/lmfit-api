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
import { OrdersService } from '../orders/orders.service';
import { Payment, type PaymentDocument } from './schemas/payment.schema';
import { PaymentWebhookDispatcherService } from './payment-webhook-dispatcher.service';
import { TenantsService } from '../tenants/tenants.service';

const DEV_PIX_PLACEHOLDER =
  '00020126580014br.gov.bcb.pix0136126e573aa-c-8eae-47a8-b10a-e143f1c18af1520400005303986540510005802BR5925LMFIT_API_DEV_PIX6009SAO_PAULO62070503***6304ABCD';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
    private readonly config: ConfigService,
    private readonly webhooks: PaymentWebhookDispatcherService,
    private readonly tenantsService: TenantsService,
  ) {}

  async createPixPayment(tenantId: string, orderId: string, amount: number): Promise<PaymentDocument> {
    if (!Types.ObjectId.isValid(orderId)) {
      throw new BadRequestException('orderId inválido');
    }
    const ttlMin = Number(this.config.get<string>('PIX_EXPIRES_MINUTES') ?? '30');
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + (Number.isFinite(ttlMin) ? ttlMin : 30));

    const provider = (this.config.get<string>('PIX_PROVIDER') ?? 'dev').toLowerCase();
    const qrCode = provider === 'dev' ? DEV_PIX_PLACEHOLDER : DEV_PIX_PLACEHOLDER;
    const qrCodeImage = this.config.get<string>('PIX_DEV_QR_IMAGE');

    const doc = await this.paymentModel.create({
      tenantId: new Types.ObjectId(tenantId),
      orderId: new Types.ObjectId(orderId),
      status: 'pending',
      method: 'pix',
      amount,
      qrCode,
      qrCodeImage: qrCodeImage?.trim() || undefined,
      expiresAt,
    });
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

    const localSimulationUrl = `/checkout/payment-simulation?paymentId=${doc._id}`;
    doc.checkoutUrl = localSimulationUrl;

    try {
      const tenant = await this.tenantsService.findById(tenantId);
      if (tenant && tenant.infinitePayTag && tenant.infinitePayApiKey) {
        const order = (await this.orders.findOne(tenantId, orderId)) as any;
        if (order) {
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

          // Fetch customer info if available
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
          const handle = tenant.infinitePayTag.trim().replace(/^\$/, '');

          const payload = {
            handle,
            order_nsu: String(doc._id),
            redirect_url: `${webAdminBaseUrl}/pedido/novo?session=draft:${order.reference?.split(':')[1] || ''}`,
            webhook_url: `${publicApiBaseUrl}/public/payments/infinitepay-webhook`,
            items,
            customer: customerData,
          };

          const sessionToken = order.reference?.startsWith('draft:') ? order.reference.split(':')[1] : '';
          if (sessionToken) {
            payload.redirect_url = `${webAdminBaseUrl}/pedido/novo?session=${encodeURIComponent(sessionToken)}`;
          }

          const response = await fetch('https://api.checkout.infinitepay.io/links', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${tenant.infinitePayApiKey.trim()}`,
            },
            body: JSON.stringify(payload),
          });

          if (response.ok) {
            const resJson = await response.json() as any;
            if (resJson && resJson.url) {
              doc.checkoutUrl = resJson.url;
            }
          } else {
            console.error('InfinitePay Link creation failed with status:', response.status);
            const errText = await response.text();
            console.error('InfinitePay Link error response:', errText);
          }
        }
      }
    } catch (err) {
      console.error('Error in createInfinitePayPayment call:', err);
    }

    await doc.save();
    return doc;
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
      });
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
