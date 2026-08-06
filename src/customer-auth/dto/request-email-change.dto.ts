import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class RequestEmailChangeDto {
  @ApiProperty()
  @IsEmail()
  newEmail: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  redirectBase?: string;
}
