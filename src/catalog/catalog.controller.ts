import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { TenantId } from '../common/decorators/tenant-id.decorator';

@ApiTags('public-catalog')
@Controller('public/catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('categories')
  listCategories(@TenantId() tenantId: string) {
    return this.catalogService.listCategories(tenantId);
  }

  @Get('products')
  listProducts(@TenantId() tenantId: string) {
    return this.catalogService.listProducts(tenantId);
  }

  @Get('products/:slug')
  getProductBySlug(
    @TenantId() tenantId: string,
    @Param('slug') slug: string,
  ) {
    return this.catalogService.getProductBySlug(tenantId, slug);
  }
}
