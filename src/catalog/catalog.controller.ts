import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CatalogService } from './catalog.service';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { PublicCatalogQueryDto } from '../products/dto/public-catalog-query.dto';

// O default global (120/min) é rastreado por tenant, não por visitante — várias pessoas
// navegando a mesma loja dividem um único balde. Leitura pública de catálogo é barata e
// esperada em volume (cada filtro/scroll dispara uma chamada); usa um teto bem mais alto
// que o default para não derrubar tráfego legítimo de loja movimentada.
@Throttle({ default: { limit: 1000, ttl: 60_000 } })
@ApiTags('public-catalog')
@Controller('public/catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('categories')
  listCategories(@TenantId() tenantId: string) {
    return this.catalogService.listCategories(tenantId);
  }

  @Get('facets')
  getFacets(@TenantId() tenantId: string) {
    return this.catalogService.getFacets(tenantId);
  }

  @Get('products')
  listProducts(@Query() query: PublicCatalogQueryDto, @TenantId() tenantId: string) {
    return this.catalogService.listProducts(tenantId, query);
  }

  @Get('products/:slug')
  getProductBySlug(
    @TenantId() tenantId: string,
    @Param('slug') slug: string,
  ) {
    return this.catalogService.getProductBySlug(tenantId, slug);
  }
}
