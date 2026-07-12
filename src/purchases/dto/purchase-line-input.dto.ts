import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsMongoId, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';

/**
 * Cria uma variante (cor/tamanho) nova ao lançar a compra, em vez de referenciar uma
 * `ProductVariant` já existente — usado quando o fornecedor está trazendo uma peça/cor/
 * tamanho que a loja ainda não tinha cadastrado.
 */
export class PurchaseNewVariantDto {
  @ApiPropertyOptional({ description: 'Produto já cadastrado ao qual esta variação pertence.' })
  @IsOptional()
  @IsMongoId()
  productId?: string;

  @ApiPropertyOptional({
    description:
      'Nome de um produto que ainda não existe — usado no lugar de productId; o produto é criado junto com a variação (uma vez só, mesmo que várias linhas da mesma compra usem o mesmo nome).',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  newProductName?: string;

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

  @ApiPropertyOptional({ description: 'Preço de venda da variação nova; se omitido, fica 0 (ajustável depois em Produtos).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;
}

export class PurchaseLineInputDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  variantId?: string;

  @ApiPropertyOptional({
    type: PurchaseNewVariantDto,
    description: 'Preenchido no lugar de variantId para criar uma variação nova nesta compra.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PurchaseNewVariantDto)
  newVariant?: PurchaseNewVariantDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  materialId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  rawName?: string;

  @ApiPropertyOptional({ description: 'Preço unitário pago pelo item' })
  @IsOptional()
  @IsNumber()
  unitPrice?: number;

  @ApiProperty({ description: 'Quantidade pedida ao fornecedor' })
  @IsNumber()
  @Min(1)
  quantityOrdered: number;

  @ApiPropertyOptional({ description: 'Quantidade já recebida (default 0)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantityReceived?: number;
}
