import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { Invoice, InvoiceSchema } from '../invoices/schemas/invoice.schema';
import { OrdersModule } from '../orders/orders.module';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import {
  ProductVariant,
  ProductVariantSchema,
} from '../products/schemas/product-variant.schema';
import { Purchase, PurchaseSchema } from '../purchases/schemas/purchase.schema';
import { Supplier, SupplierSchema } from '../suppliers/schemas/supplier.schema';
import { UsersModule } from '../users/users.module';
import { SeedService } from './seed.service';

@Module({
  imports: [
    UsersModule,
    OrdersModule,
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: Supplier.name, schema: SupplierSchema },
      { name: Purchase.name, schema: PurchaseSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Product.name, schema: ProductSchema },
      { name: ProductVariant.name, schema: ProductVariantSchema },
    ]),
  ],
  providers: [SeedService],
})
export class SeedModule {}
