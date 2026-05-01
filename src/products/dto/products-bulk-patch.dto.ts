import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsMongoId,
  IsNumber,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { BrlMoney } from '../../common/money/brl-money.decorator';

export class ProductsBulkChangesDto {
  @ApiPropertyOptional({ description: 'Ajuste percentual no preço varejo (ex.: 10 = +10%)' })
  @IsOptional()
  @IsNumber()
  pricePercent?: number;

  @ApiPropertyOptional({ description: 'Define preço varejo fixo em todas as variantes' })
  @IsOptional()
  @BrlMoney()
  @IsNumber()
  priceSet?: number;

  @ApiPropertyOptional({ description: 'Delta de estoque (somado em cada variante)' })
  @IsOptional()
  @IsNumber()
  quantityInStockDelta?: number;

  @ApiPropertyOptional({ description: 'Substitui estoque em cada variante' })
  @IsOptional()
  @IsNumber()
  quantityInStockSet?: number;
}

export class ProductsBulkPatchDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsMongoId({ each: true })
  ids: string[];

  @ApiProperty({ type: ProductsBulkChangesDto })
  @ValidateNested()
  @Type(() => ProductsBulkChangesDto)
  changes: ProductsBulkChangesDto;
}
