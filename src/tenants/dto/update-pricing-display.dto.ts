import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdatePricingDisplayDto {
  @ApiPropertyOptional({ description: '0–100; 0 = sem desconto exibido/aplicado no Pix' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  pixDiscountPercent?: number;

  @ApiPropertyOptional({ description: '1–12; 1 = sem parcelamento exibido' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  maxInstallments?: number;
}
