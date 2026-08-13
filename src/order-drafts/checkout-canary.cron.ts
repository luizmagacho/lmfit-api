import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { NotificationsService } from '../notifications/notifications.service';
import { ProductVariant } from '../products/schemas/product-variant.schema';
import { TenantsService } from '../tenants/tenants.service';
import { Order } from '../orders/schemas/order.schema';
import { OrderDraftsService } from './order-drafts.service';

/** Fixo — não um valor aleatório novo a cada corrida — pra `findByWaId` (order-drafts.service.ts)
 *  reaproveitar sempre o mesmo Customer sintético em vez de criar um registro novo por dia. */
const CANARY_WA_ID = 'loop26-canary';
const DEFAULT_RETENTION_DAYS = 7;

/**
 * Loop 26 — pedido sintético diário que anda pelo MESMO caminho de serviço que um cliente real
 * (createPublic → patchByToken → submitByToken, os mesmos métodos que PublicOrderDraftsController
 * chama) contra um tenant dedicado de canário (`CANARY_TENANT_SLUG`). Molde:
 * `abandoned-cart.cron.ts` — Logger próprio, try/catch isolado, conta e loga em vez de silenciar.
 *
 * Desligado por padrão (AC9): sem `CANARY_TENANT_SLUG` configurado, `run()` retorna sem tocar em
 * nada — uma instalação nova nunca cria pedido sozinha.
 */
@Injectable()
export class CheckoutCanaryCron {
  private readonly log = new Logger(CheckoutCanaryCron.name);

  constructor(
    @InjectModel(ProductVariant.name) private readonly variantModel: Model<ProductVariant>,
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    private readonly tenants: TenantsService,
    private readonly drafts: OrderDraftsService,
    private readonly notify: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async run(): Promise<void> {
    const slug = this.config.get<string>('CANARY_TENANT_SLUG')?.trim();
    if (!slug) return;

    const sku = this.config.get<string>('CANARY_VARIANT_SKU')?.trim();
    if (!sku) {
      this.log.warn(
        'CANARY_TENANT_SLUG configurado mas CANARY_VARIANT_SKU ausente — canário não pode rodar.',
      );
      return;
    }

    let step = 'resolve_tenant';
    try {
      const tenant = await this.tenants.findBySlug(slug);
      if (!tenant || !tenant.active) {
        throw new Error(`Tenant de canário "${slug}" não encontrado ou inativo`);
      }
      const tenantId = String(tenant._id);
      const features = this.tenants.resolveFeatures(tenant);

      step = 'resolve_variant';
      const variant = await this.variantModel.findOne({ tenantId: tenant._id, sku }).exec();
      if (!variant) {
        throw new Error(`Variante de canário "${sku}" não encontrada no tenant "${slug}"`);
      }

      step = 'create_draft';
      const draft = await this.drafts.createPublic(tenantId, {
        waId: CANARY_WA_ID,
        metadata: { customer: { name: 'Canário Loop 26', phone: '00000000000' } },
      });

      step = 'patch_draft';
      await this.drafts.patchByToken(
        tenantId,
        draft.sessionToken,
        { lines: [{ variantId: String(variant._id), quantity: 1 }] },
        features,
      );

      step = 'submit_draft';
      const result = await this.drafts.submitByToken(tenantId, draft.sessionToken, {});

      this.notify.logStaffAlert('canary_ok', { tenantSlug: slug, orderId: result.orderId });
      this.log.log(`Canário do checkout OK — pedido ${result.orderId} criado no tenant "${slug}".`);
    } catch (err: any) {
      await this.alertFailure(slug, step, err);
    }
  }

  /** Poda os pedidos do tenant de canário — nunca precisa apagar na hora (a peça é isolada, ver
   *  Decisions no spec), só evitar acúmulo indefinido. Escopado por `tenantId`, não por um campo
   *  `reference` — o tenant inteiro é sintético, então qualquer pedido nele já É um pedido de
   *  canário, por construção. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async prune(): Promise<void> {
    const slug = this.config.get<string>('CANARY_TENANT_SLUG')?.trim();
    if (!slug) return;

    const tenant = await this.tenants.findBySlug(slug);
    if (!tenant) return;

    const days = Number(this.config.get<string>('CANARY_RETENTION_DAYS') ?? DEFAULT_RETENTION_DAYS);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const res = await this.orderModel
      .deleteMany({ tenantId: tenant._id, createdAt: { $lt: cutoff } })
      .exec();
    if (res.deletedCount) {
      this.log.log(`Canário: ${res.deletedCount} pedido(s) com mais de ${days} dia(s) removido(s).`);
    }
  }

  private async alertFailure(slug: string, step: string, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    this.log.error(`Canário do checkout falhou na etapa "${step}" (tenant "${slug}"): ${message}`);
    this.notify.logStaffAlert('canary_failed', { tenantSlug: slug, step, message });
    await this.notify
      .sendStaffEmail(
        `[Kivoni] Canário do checkout falhou (${step})`,
        `O pedido sintético diário do Loop 26 falhou na etapa "${step}" no tenant "${slug}":\n\n${message}`,
      )
      .catch(() => undefined);
  }
}
