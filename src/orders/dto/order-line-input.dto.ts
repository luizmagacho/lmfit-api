import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsMongoId, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { BrlMoney } from '../../common/money/brl-money.decorator';

export class OrderLineInputDto {
  @ApiProperty()
  @IsMongoId()
  variantId: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: 'Número ou string BRL / só dígitos como centavos' })
  @BrlMoney()
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Preço/custo de produção unitário' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  productionPrice?: number;

  @ApiPropertyOptional({ description: 'Se true, não deduz estoque (encomenda)' })
  @IsOptional()
  @IsBoolean()
  isOrder?: boolean;
}
