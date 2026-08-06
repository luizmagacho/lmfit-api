import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReturnLineInputDto {
  @ApiProperty()
  @IsMongoId()
  variantId: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateReturnDto {
  @ApiProperty({ enum: ['return', 'exchange', 'refund'] })
  @IsEnum(['return', 'exchange', 'refund'])
  type: 'return' | 'exchange' | 'refund';

  @ApiProperty({ type: [ReturnLineInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineInputDto)
  lines: ReturnLineInputDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

/** Base compartilhada pelas solicitações feitas pelo cliente (guest ou logado) — mesmas linhas/tipo/
 *  notas de `CreateReturnDto`, mais a variante desejada (informativa) para `type: 'exchange'`. */
export class CreateReturnRequestDto extends CreateReturnDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  desiredVariantId?: string;
}

export class PublicReturnLookupDto {
  @ApiProperty()
  @IsNumber()
  orderNumber: number;

  @ApiProperty()
  @IsString()
  phone: string;
}

export class PublicReturnRequestDto extends CreateReturnRequestDto {
  @ApiProperty()
  @IsNumber()
  orderNumber: number;

  @ApiProperty()
  @IsString()
  phone: string;
}

export class CustomerReturnRequestDto extends CreateReturnRequestDto {
  @ApiProperty()
  @IsMongoId()
  orderId: string;
}

export class RejectReturnDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
