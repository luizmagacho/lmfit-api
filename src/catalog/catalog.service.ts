import { Injectable } from '@nestjs/common';
import { ProductsService } from '../products/products.service';

@Injectable()
export class CatalogService {
  constructor(private readonly productsService: ProductsService) {}

  listCategories(tenantId: string) {
    return this.productsService.listPublicCatalogCategories(tenantId);
  }

  async listProducts(tenantId: string) {
    const items = await this.productsService.listPublicCatalog(tenantId);
    return { items, total: items.length };
  }

  getProductBySlug(tenantId: string, slug: string) {
    return this.productsService.getPublicProductBySlug(tenantId, slug);
  }
}
