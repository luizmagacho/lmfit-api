import { Injectable } from '@nestjs/common';
import { ProductsService } from '../products/products.service';
import type { PublicCatalogQueryDto } from '../products/dto/public-catalog-query.dto';

@Injectable()
export class CatalogService {
  constructor(private readonly productsService: ProductsService) {}

  listCategories(tenantId: string) {
    return this.productsService.listPublicCatalogCategories(tenantId);
  }

  listProducts(tenantId: string, query?: PublicCatalogQueryDto) {
    return this.productsService.listPublicCatalog(tenantId, query);
  }

  getFacets(tenantId: string) {
    return this.productsService.getPublicCatalogFacets(tenantId);
  }

  getProductBySlug(tenantId: string, slug: string) {
    return this.productsService.getPublicProductBySlug(tenantId, slug);
  }
}
