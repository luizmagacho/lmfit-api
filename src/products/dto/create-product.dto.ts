import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BrlMoney } from '../../common/money/brl-money.decorator';
import { ProductVariantUpsertDto } from './product-variant-upsert.dto';

export class CreateProductDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  slug: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description:
      'Denormalizado (ex.: primeira variante). Usado se `variants` vier vazio e houver sku.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  sku?: string;

  @ApiPropertyOptional({ description: 'Número ou string BRL / só dígitos como centavos' })
  @IsOptional()
  @BrlMoney()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantityInStock?: number;

  @ApiPropertyOptional({ description: 'Preço varejo no nível produto (fallback se variante não definir).' })
  @IsOptional()
  @BrlMoney()
  @IsNumber()
  @Min(0)
  priceRetail?: number;

  @ApiPropertyOptional({
    description: 'Preço atacado; omitir ou null = mesmo que varejo na leitura.',
    nullable: true,
  })
  @IsOptional()
  @BrlMoney()
  @IsNumber()
  @Min(0)
  priceWholesale?: number | null;

  @ApiPropertyOptional({ default: 6 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minWholesaleQty?: number;

  @ApiPropertyOptional({ description: 'Número ou string BRL / só dígitos como centavos' })
  @IsOptional()
  @BrlMoney()
  @IsNumber()
  @Min(0)
  compareAtPrice?: number;

  @ApiPropertyOptional({
    description: 'URL canônica da imagem principal (HTTPS). Enviada após POST /products/images.',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  primaryImageUrl?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Galeria: URLs adicionais de imagens.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @ApiPropertyOptional({ description: 'EAN / GTIN', nullable: true })
  @IsOptional()
  @IsString()
  barcode?: string;

  @ApiPropertyOptional({ description: 'Peso em gramas para frete (Correios)', nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  weightGrams?: number;

  @ApiPropertyOptional({
    type: [ProductVariantUpsertDto],
    description:
      'Lista completa de variantes (cor × tamanho). Se enviado, não pode ser array vazio.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductVariantUpsertDto)
  variants?: ProductVariantUpsertDto[];

  @ApiPropertyOptional({
    enum: ['manufactured', 'ready_made'],
    default: 'manufactured',
    description:
      '"ready_made" = item pronto comprado de fornecedor: exige supplierId + costPrice + markupPercent, e o preço de venda é calculado no servidor a partir deles.',
  })
  @IsOptional()
  @IsEnum(['manufactured', 'ready_made'])
  sourceType?: 'manufactured' | 'ready_made';

  @ApiPropertyOptional({ description: 'Preço de custo (obrigatório quando sourceType = ready_made).' })
  @IsOptional()
  @BrlMoney()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @ApiPropertyOptional({
    description: 'Margem desejada sobre o custo, em % (ex.: 50 = venda por 1,5x o custo).',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  markupPercent?: number;

  @ApiPropertyOptional({ description: 'Fornecedor do item pronto (obrigatório quando sourceType = ready_made).' })
  @IsOptional()
  @IsMongoId()
  supplierId?: string;
}
