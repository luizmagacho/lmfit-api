import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateLoyaltyConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Pontos ganhos por real gasto no pedido' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  pointsPerBRL?: number;

  @ApiPropertyOptional({ description: 'Valor em reais de cada ponto resgatado' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  redeemValuePerPoint?: number;
}
