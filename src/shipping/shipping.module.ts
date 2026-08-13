import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { ProductVariant, ProductVariantSchema } from '../products/schemas/product-variant.schema';
import { MelhorEnvioAdapter } from './adapters/melhor-envio.adapter';
import { PublicShippingController } from './public-shipping.controller';
import { ShippingQuoteService } from './shipping-quote.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: ProductVariant.name, schema: ProductVariantSchema },
    ]),
  ],
  controllers: [PublicShippingController],
  providers: [MelhorEnvioAdapter, ShippingQuoteService],
  exports: [ShippingQuoteService],
})
export class ShippingModule {}
