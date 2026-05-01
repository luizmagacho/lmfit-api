import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

export class ProductImageDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  url: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  sort?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  alt?: string;
}
