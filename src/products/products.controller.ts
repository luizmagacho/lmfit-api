import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ImportJsonDto } from '../common/dto/import-json.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { ProductsBulkPatchDto } from './dto/products-bulk-patch.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';
import { productImageUploadOptions } from './upload.config';

@ApiTags('products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.products.createProduct(dto);
  }

  /**
   * POST /products/images
   * Upload a single JPEG or PNG; returns { url } for use in primaryImageUrl.
   * Must be registered before :id routes.
   */
  @Post('images')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', productImageUploadOptions))
  uploadImage(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado no campo "file".');
    }
    if ((file as { size?: number }).size && (file as { size: number }).size > 5 * 1024 * 1024) {
      throw new PayloadTooLargeException('Arquivo excede o limite de 5 MB.');
    }
    // Se Cloudinary foi usado, ele retorna a URL completa no file.path
    if (file.path && file.path.startsWith('http')) {
      return { url: file.path };
    }

    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol ?? 'http';
    const host = req.headers['host'] ?? 'localhost:4000';
    const url = `${proto}://${host}/uploads/products/${file.filename}`;
    return { url };
  }

  @Get()
  list(@Query() q: PaginationQueryDto) {
    return this.products.listProducts(q.page, q.limit, q.search);
  }

  @Get('export')
  async export(@Query('format') format?: string, @Query('search') search?: string) {
    const fmt = (format ?? 'xlsx').toLowerCase();
    if (fmt !== 'xlsx' && fmt !== 'csv') {
      throw new BadRequestException({ message: 'format must be xlsx or csv' });
    }
    const { buffer, filename, mime } = await this.products.exportProductsBuffer(
      fmt as 'xlsx' | 'csv',
      search,
    );
    return new StreamableFile(buffer, {
      type: mime,
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Post('import')
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }),
  )
  async importStaff(
    @Req() req: Request,
    @Body() body: ImportJsonDto | Record<string, never>,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Query('dryRun') dryRunQ?: string,
  ) {
    const dryRun = dryRunQ === 'true' || dryRunQ === '1';
    const ct = req.headers['content-type'] ?? '';
    if (ct.includes('application/json')) {
      const b = body as ImportJsonDto;
      if (!b?.items || !Array.isArray(b.items)) {
        throw new BadRequestException({
          message: 'JSON body must include items[]',
        });
      }
      return this.products.importProductsFromJson(b.items, b.dryRun ?? dryRun);
    }
    if (file?.buffer?.length) {
      return this.products.importProductsFromXlsx(file.buffer, dryRun);
    }
    throw new BadRequestException({
      message:
        'Send JSON { "items": [...], "dryRun"?: boolean } or multipart field file',
    });
  }

  @Patch('bulk')
  bulkPatch(@Body() dto: ProductsBulkPatchDto) {
    return this.products.bulkPatch(dto);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.products.getProduct(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.updateProduct(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.products.removeProduct(id);
  }

  @Post(':productId/variants')
  createVariant(
    @Param('productId') productId: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.products.createVariant(productId, dto);
  }
}
