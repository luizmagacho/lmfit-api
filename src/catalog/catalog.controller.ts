import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ProductsService } from '../products/products.service';

@ApiTags('public-catalog')
@Controller('public/catalog')
export class CatalogController {
  constructor(private readonly productsService: ProductsService) {}

  @Get('categories')
  listCategories() {
    return this.productsService.listPublicCatalogCategories();
  }

  @Get('products')
  async listProducts() {
    const items = await this.productsService.listPublicCatalog();
    return { items, total: items.length };
  }

  @Get('products/:slug')
  getProductBySlug(@Param('slug') slug: string) {
    return this.productsService.getPublicProductBySlug(slug);
  }
}
