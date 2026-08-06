import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateShippingConfigDto {
  @ApiPropertyOptional({ description: 'Rótulo exibido para a opção de retirada em loja' })
  @IsOptional()
  @IsString()
  pickupLabel?: string;

  @ApiPropertyOptional({ description: 'Taxa fixa da entrega padrão' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  standardFee?: number;

  @ApiPropertyOptional({ description: 'Taxa fixa da entrega expressa' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  expressFee?: number;

  @ApiPropertyOptional({ description: 'Subtotal a partir do qual standard/express ficam grátis (0/vazio = sem isenção)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  freeAboveTotal?: number;
}
