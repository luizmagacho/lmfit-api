import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Product, ProductSchema } from './schemas/product.schema';
import {
  ProductVariant,
  ProductVariantSchema,
} from './schemas/product-variant.schema';
import { StockLedger, StockLedgerSchema } from './schemas/stock-ledger.schema';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { VariantsController } from './variants.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: ProductVariant.name, schema: ProductVariantSchema },
      { name: StockLedger.name, schema: StockLedgerSchema },
    ]),
  ],
  controllers: [ProductsController, VariantsController],
  providers: [ProductsService],
  exports: [ProductsService, MongooseModule],
})
export class ProductsModule {}
