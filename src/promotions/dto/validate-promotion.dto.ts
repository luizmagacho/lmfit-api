import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, Min, MinLength } from 'class-validator';

export class ValidatePromotionDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  code: string;

  @ApiProperty({ description: 'Subtotal do pedido (soma das linhas), antes de frete' })
  @IsNumber()
  @Min(0)
  subtotal: number;
}
