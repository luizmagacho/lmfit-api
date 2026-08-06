import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RejectReviewDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
