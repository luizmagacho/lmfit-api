import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateAddressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  cep: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  logradouro: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  numero?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  complemento?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  bairro: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  cidade: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  uf: string;
}

export class UpdateAddressDto extends PartialType(CreateAddressDto) {}
