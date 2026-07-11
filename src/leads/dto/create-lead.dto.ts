import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateLeadDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  customerName: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  customerPhone: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  productDescription: string;
}
