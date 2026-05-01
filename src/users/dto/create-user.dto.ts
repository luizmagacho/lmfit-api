import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { USER_ROLE_VALUES, type UserRole } from '../schemas/user.schema';

export class CreateUserDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional({ enum: [...USER_ROLE_VALUES] })
  @IsOptional()
  @IsIn([...USER_ROLE_VALUES])
  role?: UserRole;
}
