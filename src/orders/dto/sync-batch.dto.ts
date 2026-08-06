import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { OrderLineInputDto } from './order-line-input.dto';

export class OfflineSaleDto {
  @ApiProperty({ description: 'Chave de idempotência gerada no PDV — reenviar não duplica o pedido' })
  @IsString()
  clientSaleId: string;

  @ApiProperty()
  @IsMongoId()
  customerId: string;

  @ApiProperty({ enum: ['pix', 'cash', 'card'] })
  @IsEnum(['pix', 'cash', 'card'])
  paymentMethod: 'pix' | 'cash' | 'card';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [OrderLineInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  lines: OrderLineInputDto[];

  @ApiProperty({ description: 'Quando a venda foi feita de verdade no PDV, mesmo que sincronizada depois' })
  @IsISO8601()
  createdAtLocal: string;
}

export class SyncBatchDto {
  @ApiProperty({ type: [OfflineSaleDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OfflineSaleDto)
  sales: OfflineSaleDto[];
}
