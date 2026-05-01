import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { BrlMoney } from '../../common/money/brl-money.decorator';
import { PurchaseLineInputDto } from './purchase-line-input.dto';

export class CreatePurchaseDto {
  @ApiProperty()
  @IsMongoId()
  supplierId: string;

  @ApiPropertyOptional({ enum: ['pending', 'received', 'cancelled'] })
  @IsOptional()
  @IsEnum(['pending', 'received', 'cancelled'])
  status?: 'pending' | 'received' | 'cancelled';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({ default: 0, description: 'Número ou string BRL / só dígitos como centavos' })
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
