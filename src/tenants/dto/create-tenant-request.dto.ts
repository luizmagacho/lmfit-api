import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Matches } from 'class-validator';

export class CreateTenantRequestDto {
  @ApiProperty({ example: 'LM Fit' })
  @IsString()
  @IsNotEmpty()
  storeName: string;

  @ApiProperty({ example: 'Luiz Fernando' })
  @IsString()
  @IsNotEmpty()
  ownerName: string;

  @ApiProperty({ example: 'contato@kivoni.com.br' })
  @IsEmail()
  @IsNotEmpty()
  ownerEmail: string;

  @ApiProperty({ example: '11999999999' })
  @IsString()
  @IsNotEmpty()
  ownerPhone: string;

  @ApiProperty({ example: 'lmfit' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, {
    message: 'desiredDomain must be lowercase alphanumeric with hyphens, min 2 chars',
  })
  desiredDomain: string;
}
