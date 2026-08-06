import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class VerifyMagicLinkDto {
  @ApiProperty()
  @IsString()
  token: string;
}
