import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { CatalogController } from './catalog.controller';
import { CatalogStaffController } from './catalog-staff.controller';

@Module({
  imports: [ProductsModule],
  controllers: [CatalogController, CatalogStaffController],
})
export class CatalogModule {}
