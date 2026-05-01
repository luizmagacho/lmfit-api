import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsNumber, IsOptional, IsString, Min } from 'class-validator';
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
}
