import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Purchase, PurchaseSchema } from './schemas/purchase.schema';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';

import { ProductVariant, ProductVariantSchema } from '../products/schemas/product-variant.schema';
import { Material, MaterialSchema } from '../materials/schemas/material.schema';
import { LocationsModule } from '../locations/locations.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Purchase.name, schema: PurchaseSchema },
      { name: ProductVariant.name, schema: ProductVariantSchema },
      { name: Material.name, schema: MaterialSchema },
    ]),
    LocationsModule,
  ],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
