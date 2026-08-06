import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const PUBLIC_CATALOG_SORTS = [
  'relevancia',
  'menor-preco',
  'maior-preco',
  'lancamentos',
] as const;
export type PublicCatalogSort = (typeof PUBLIC_CATALOG_SORTS)[number];

export class PublicCatalogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  size?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMax?: number;

  @ApiPropertyOptional({ enum: PUBLIC_CATALOG_SORTS })
  @IsOptional()
  @IsEnum(PUBLIC_CATALOG_SORTS)
  sort?: PublicCatalogSort;
}
