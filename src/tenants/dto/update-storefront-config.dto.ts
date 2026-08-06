import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const THEME_PRESETS = [
  'essencial',
  'editorial',
  'performance',
  'luxo',
  'boutique',
  'vibrante',
  'studio',
  'streetwear',
  'impacto',
  'monocromo',
] as const;

export class UpdateStorefrontPagesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  quemSomos?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comoComprar?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  guiaMedidas?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contato?: string;
}

export class UpdateStorefrontLookbookDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variantIds?: string[];
}

export class UpdateHeroBannerSlideDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  linkedProductSlug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subtitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ctaLabel?: string;
}

export class UpdateReturnPolicyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  windowDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  policyText?: string;
}

export class UpdateStorefrontConfigDto {
  @ApiPropertyOptional({ description: 'Liga/desliga a loja pública' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: THEME_PRESETS })
  @IsOptional()
  @IsEnum(THEME_PRESETS)
  themePreset?: string;

  @ApiPropertyOptional({ type: [String], description: 'Mensagens do ticker de avisos' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  announcements?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  heroTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  heroSubtitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  heroImageUrl?: string;

  @ApiPropertyOptional({ type: [String], description: 'Loop 4d — 2+ imagens vira carrossel no hero' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  heroImages?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  heroCtaLabel?: string;

  @ApiPropertyOptional({
    type: [UpdateHeroBannerSlideDto],
    description: 'Carrossel de banners promocionais menores/retangulares — cada slide tem sua própria imagem e pode linkar pra um produto diferente. Substitui o hero de título único quando configurado.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => UpdateHeroBannerSlideDto)
  heroBanners?: UpdateHeroBannerSlideDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showTrustBar?: boolean;

  @ApiPropertyOptional({ description: 'Código de uma promoção já cadastrada, só para exibição no banner' })
  @IsOptional()
  @IsString()
  couponBannerCode?: string;

  @ApiPropertyOptional({ type: UpdateStorefrontPagesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateStorefrontPagesDto)
  pages?: UpdateStorefrontPagesDto;

  @ApiPropertyOptional({ type: UpdateStorefrontLookbookDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateStorefrontLookbookDto)
  lookbook?: UpdateStorefrontLookbookDto;

  @ApiPropertyOptional({ type: UpdateReturnPolicyDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateReturnPolicyDto)
  returnPolicy?: UpdateReturnPolicyDto;

  @ApiPropertyOptional({ description: 'Loop 10 v2 — sobrescreve o <title> gerado a partir do nome do tenant' })
  @IsOptional()
  @IsString()
  @MaxLength(70)
  metaTitle?: string;

  @ApiPropertyOptional({ description: 'Loop 10 v2 — sobrescreve a meta description padrão' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  metaDescription?: string;
}
