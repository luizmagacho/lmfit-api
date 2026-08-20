import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Product, ProductSchema } from './schemas/product.schema';
import {
  ProductVariant,
  ProductVariantSchema,
} from './schemas/product-variant.schema';
import { StockLedger, StockLedgerSchema } from './schemas/stock-ledger.schema';
import { Counter, CounterSchema } from '../common/counters/counter.schema';
import { CountersService } from '../common/counters/counters.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { VariantsController } from './variants.controller';
import { LocationsModule } from '../locations/locations.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: ProductVariant.name, schema: ProductVariantSchema },
      { name: StockLedger.name, schema: StockLedgerSchema },
      { name: Counter.name, schema: CounterSchema },
    ]),
    LocationsModule,
  ],
  controllers: [ProductsController, VariantsController],
  providers: [ProductsService, CountersService],
  exports: [ProductsService, MongooseModule],
})
export class ProductsModule {}
