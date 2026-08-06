import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsMongoId, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateReviewDto {
  @ApiProperty()
  @IsMongoId()
  productId: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
