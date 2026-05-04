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
  ) {}

  async createPixPayment(orderId: string, amount: number): Promise<PaymentDocument> {
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

  async findPublicStatusById(id: string): Promise<{ status: string }> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const p = await this.paymentModel.findById(id).select('status').lean().exec();
    if (!p) throw new NotFoundException();
    return { status: p.status };
  }

  /** Confirma PIX: pedido → `paid` (estoque via OrdersService) e pagamento → `paid`. */
  async confirmPixPaymentPaid(paymentId: string): Promise<void> {
    if (!Types.ObjectId.isValid(paymentId)) throw new NotFoundException();
    const p = await this.paymentModel.findById(paymentId).exec();
    if (!p) throw new NotFoundException();
    if (p.status !== 'pending') {
      throw new BadRequestException('Pagamento não está pendente');
    }
    const orderId = String(p.orderId);
    await this.orders.update(orderId, { status: 'completed' }, undefined);
  }

  async markExpiredIfDue(paymentId: string): Promise<void> {
    const p = await this.paymentModel.findById(paymentId).exec();
    if (!p || p.status !== 'pending') return;
    if (p.expiresAt >= new Date()) return;
    p.status = 'expired';
    await p.save();
    await this.webhooks.dispatchPaymentEvent('payment.expired', {
      paymentId: String(p._id),
      orderId: String(p.orderId),
      status: 'expired',
      amount: p.amount,
    });
  }

  async syncPaymentPaidForOrder(orderId: Types.ObjectId): Promise<void> {
    await this.paymentModel
      .updateMany(
        { orderId, status: 'pending' },
        { $set: { status: 'paid', paidAt: new Date() } },
      )
      .exec();
    const one = await this.paymentModel
      .findOne({ orderId, status: 'paid' })
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

  async cancelPendingForOrder(orderId: Types.ObjectId): Promise<void> {
    const pending = await this.paymentModel
      .find({ orderId, status: 'pending' })
      .lean()
      .exec();
    if (!pending.length) return;
    await this.paymentModel
      .updateMany({ orderId, status: 'pending' }, { $set: { status: 'cancelled' } })
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
}
