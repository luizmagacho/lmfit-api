import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { ReportsQueryDto } from './reports-query.dto';

export class ReportsRevenueQueryDto extends ReportsQueryDto {
  @ApiPropertyOptional({ description: 'Número de produtos no ranking', default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number;
}
