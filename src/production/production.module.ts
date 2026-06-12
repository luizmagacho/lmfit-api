import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductionBatch, ProductionBatchSchema } from './schemas/production-batch.schema';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';

import { ProductVariant, ProductVariantSchema } from '../products/schemas/product-variant.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProductionBatch.name, schema: ProductionBatchSchema },
      { name: ProductVariant.name, schema: ProductVariantSchema },
    ]),
  ],
  controllers: [ProductionController],
  providers: [ProductionService],
  exports: [ProductionService],
})
export class ProductionModule {}
