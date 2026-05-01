import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class ReportsQueryDto {
  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  @IsDateString()
  from: string;

  @ApiProperty({ example: '2026-12-31T23:59:59.999Z' })
  @IsDateString()
  to: string;
}
