import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreatePromotionDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  code: string;

  @ApiProperty({ enum: ['percent', 'fixed'] })
  @IsEnum(['percent', 'fixed'])
  type: 'percent' | 'fixed';

  @ApiProperty({ description: 'Percentual (0-100) ou valor fixo em reais' })
  @IsNumber()
  @Min(0)
  value: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  minSubtotal?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validFrom?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validUntil?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
