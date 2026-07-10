import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BrlMoney } from '../../common/money/brl-money.decorator';
import { ProductImageDto } from './product-image.dto';

/** Payload enviado pelo admin (lmfit-web) dentro de `variants` em POST/PATCH /products. */
export class ProductVariantUpsertDto {
  @ApiPropertyOptional({ description: 'Omitir em variantes novas; o servidor gera _id.' })
  @IsOptional()
  @IsMongoId()
  _id?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  sku: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  size?: string;

  @ApiPropertyOptional({
    description: 'Preço varejo (legado). Use `priceRetail` se preferir; um dos dois deve vir.',
  })
  @IsOptional()
  @BrlMoney()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ description: 'Preço varejo (prioridade sobre `price` se ambos vierem).' })
  @IsOptional()
  @BrlMoney()
  @IsNumber()
  @Min(0)
  priceRetail?: number;

  @ApiPropertyOptional({ nullable: true, description: 'null = herdar produto / usar varejo.' })
  @IsOptional()
  @BrlMoney()
  @IsNumber()
  @Min(0)
  priceWholesale?: number | null;

  @ApiPropertyOptional({ description: 'Mínimo de unidades para preço atacado nesta variante.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minWholesaleQty?: number;

  @ApiPropertyOptional({
    description: 'Estoque (inteiro ≥ 0). Espelhado em quantityOnHand no armazenamento.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantityInStock?: number;

  @ApiPropertyOptional({ description: 'Se omitido, usa quantityInStock ou 0.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantityOnHand?: number;

  @ApiPropertyOptional({
    default: false,
    description: 'Permite vender além do estoque (produção sob encomenda). Requer plano com a feature "production".',
  })
  @IsOptional()
  @IsBoolean()
  acceptsBackorder?: boolean;

  @ApiPropertyOptional({ description: 'Número ou string BRL / só dígitos como centavos' })
  @IsOptional()
  @BrlMoney()
  @IsNumber()
  @Min(0)
  compareAtPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  barcode?: string;

  @ApiPropertyOptional({ type: [ProductImageDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];
}
