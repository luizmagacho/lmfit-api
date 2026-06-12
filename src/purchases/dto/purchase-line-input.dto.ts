import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsNumber, IsOptional, Min } from 'class-validator';

export class PurchaseLineInputDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  variantId?: string;

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
