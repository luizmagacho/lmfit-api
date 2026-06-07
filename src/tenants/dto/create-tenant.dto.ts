import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { TENANT_PLAN_VALUES, type TenantPlan } from '../schemas/tenant.schema';

export class BrandingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  faviconUrl?: string;

  @ApiPropertyOptional({ default: '#7c3aed' })
  @IsOptional()
  @IsString()
  primaryColor?: string;

  @ApiPropertyOptional({ default: '#06b6d4' })
  @IsOptional()
  @IsString()
  secondaryColor?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  darkMode?: boolean;
}

export class LimitsDto {
  @ApiPropertyOptional({ default: -1, description: '-1 = unlimited' })
  @IsOptional()
  @IsNumber()
  maxProducts?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber()
  maxUsers?: number;
}

export class CreateTenantDto {
  @ApiProperty({ example: 'lmfit' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, {
    message: 'slug must be lowercase alphanumeric with hyphens, min 2 chars',
  })
  slug: string;

  @ApiProperty({ example: 'LM Fit Moda Fitness' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ enum: TENANT_PLAN_VALUES, default: 'free' })
  @IsOptional()
  @IsEnum(TENANT_PLAN_VALUES)
  plan?: TenantPlan;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsappNumber?: string;

  @ApiPropertyOptional({ type: BrandingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandingDto)
  branding?: BrandingDto;

  @ApiPropertyOptional({ type: LimitsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LimitsDto)
  limits?: LimitsDto;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  featuresOverride?: string[];
}
