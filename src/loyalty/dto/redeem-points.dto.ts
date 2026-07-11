import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class RedeemPointsDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  points: number;
}
