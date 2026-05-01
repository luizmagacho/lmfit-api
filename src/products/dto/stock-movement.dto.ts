import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

export class StockMovementDto {
  @ApiProperty({ description: 'Positive to add stock, negative to remove' })
  @IsNumber()
  delta: number;

  @ApiProperty({
    enum: [
      'adjustment',
      'sale',
      'sale_reversal',
      'purchase_receipt',
      'return',
      'initial',
    ],
  })
  @IsEnum([
    'adjustment',
    'sale',
    'sale_reversal',
    'purchase_receipt',
    'return',
    'initial',
  ])
  reason:
    | 'adjustment'
    | 'sale'
    | 'sale_reversal'
    | 'purchase_receipt'
    | 'return'
    | 'initial';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
