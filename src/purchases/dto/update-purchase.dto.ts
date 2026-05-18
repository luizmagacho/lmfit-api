import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { BrlMoney } from '../../common/money/brl-money.decorator';
import { PurchaseLineInputDto } from './purchase-line-input.dto';

export class UpdatePurchaseDto {
  @ApiPropertyOptional({ enum: ['interest', 'order_reserved', 'in_transit', 'received', 'cancelled'] })
  @IsOptional()
  @IsEnum(['interest', 'order_reserved', 'in_transit', 'received', 'cancelled'])
  status?: 'interest' | 'order_reserved' | 'in_transit' | 'received' | 'cancelled';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({ description: 'Número ou string BRL / só dígitos como centavos' })
  @IsOptional()
  @BrlMoney()
  @IsNumber()
  @Min(0)
  total?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [PurchaseLineInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineInputDto)
  lines?: PurchaseLineInputDto[];
}
