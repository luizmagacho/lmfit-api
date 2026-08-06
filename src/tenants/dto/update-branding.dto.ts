import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateBrandingDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  infinitePayTag?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  infinitePayApiKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  geminiApiKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  metaAppSecret?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  metaWhatsappVerifyToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  metaWhatsappPhoneNumberId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  metaWhatsappAccessToken?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  whatsappAiEnabled?: boolean;
}
