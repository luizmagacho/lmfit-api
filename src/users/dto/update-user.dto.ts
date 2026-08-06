import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsOptional, IsString, MinLength } from 'class-validator';
import { USER_ROLE_VALUES, type UserRole } from '../schemas/user.schema';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ enum: [...USER_ROLE_VALUES] })
  @IsOptional()
  @IsIn([...USER_ROLE_VALUES])
  role?: UserRole;

  @ApiPropertyOptional({ minLength: 6 })
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @ApiPropertyOptional({ description: 'Local fixo de trabalho (PDV offline); null para remover' })
  @IsOptional()
  @IsMongoId()
  assignedLocationId?: string | null;
}
