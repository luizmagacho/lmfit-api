import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CustomerRefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;
}
