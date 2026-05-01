import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { NotificationsService } from '../notifications/notifications.service';
import { ProductsService } from '../products/products.service';
import { LowStockAlert } from './schemas/low-stock-alert.schema';

@Injectable()
export class LowStockCron {
  private readonly log = new Logger(LowStockCron.name);

  constructor(
    private readonly products: ProductsService,
    private readonly notify: NotificationsService,
    @InjectModel(LowStockAlert.name)
    private readonly alertModel: Model<LowStockAlert>,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkLowStock(): Promise<void> {
    const variants = await this.products.listVariantsNeedingReorder();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    for (const v of variants) {
      const recent = await this.alertModel
        .findOne({
          variantId: new Types.ObjectId(String(v._id)),
          createdAt: { $gte: dayAgo },
        })
        .exec();
      if (recent) continue;
      await this.alertModel.create({
        variantId: v._id,
        onHandSnapshot: v.quantityOnHand,
        reorderPointSnapshot: v.reorderPoint,
      });
      const pid = v.productId as { name?: string } | null | undefined;
      const pname =
        pid && typeof pid === 'object' && 'name' in pid
          ? String(pid.name ?? '')
          : '';
      const subject = `[LM FIT] Estoque baixo: ${v.sku}`;
      const text = `Produto: ${pname}\nSKU: ${v.sku}\nCor/Tam: ${v.color ?? '-'} / ${v.size ?? '-'}\nEm mãos: ${v.quantityOnHand}\nPonto de reposição: ${v.reorderPoint}`;
      await this.notify.sendStaffEmail(subject, text).catch((e) =>
        this.log.error(String(e)),
      );
      this.notify.logStaffAlert('low_stock', {
        sku: v.sku,
        onHand: v.quantityOnHand,
      });
    }
  }
}
