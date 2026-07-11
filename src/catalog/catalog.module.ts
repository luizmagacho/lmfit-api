import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { CatalogController } from './catalog.controller';
import { CatalogStaffController } from './catalog-staff.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [ProductsModule],
  controllers: [CatalogController, CatalogStaffController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
