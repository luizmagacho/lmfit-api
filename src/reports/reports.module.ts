import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import {
  ProductVariant,
  ProductVariantSchema,
} from '../products/schemas/product-variant.schema';
import { Purchase, PurchaseSchema } from '../purchases/schemas/purchase.schema';
import { ProductionBatch, ProductionBatchSchema } from '../production/schemas/production-batch.schema';
import { Promotion, PromotionSchema } from '../promotions/schemas/promotion.schema';
import { Influencer, InfluencerSchema } from '../influencers/schemas/influencer.schema';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Product.name, schema: ProductSchema },
      { name: ProductVariant.name, schema: ProductVariantSchema },
      { name: Purchase.name, schema: PurchaseSchema },
      { name: ProductionBatch.name, schema: ProductionBatchSchema },
      { name: Promotion.name, schema: PromotionSchema },
      { name: Influencer.name, schema: InfluencerSchema },
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
