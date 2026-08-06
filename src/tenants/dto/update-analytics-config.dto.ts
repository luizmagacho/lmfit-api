import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateAnalyticsConfigDto {
  @ApiPropertyOptional({ description: 'Pixel ID do Meta (Facebook/Instagram Ads)' })
  @IsOptional()
  @IsString()
  metaPixelId?: string;

  @ApiPropertyOptional({ description: 'Access token da Conversions API do Meta (server-side, opcional)' })
  @IsOptional()
  @IsString()
  metaConversionsApiToken?: string;

  @ApiPropertyOptional({ description: 'Measurement ID do Google Analytics 4 (G-XXXXXXX)' })
  @IsOptional()
  @IsString()
  ga4MeasurementId?: string;

  @ApiPropertyOptional({ description: 'API secret do Measurement Protocol do GA4 (server-side, opcional)' })
  @IsOptional()
  @IsString()
  ga4ApiSecret?: string;

  @ApiPropertyOptional({ description: 'Pixel code do TikTok Ads' })
  @IsOptional()
  @IsString()
  tiktokPixelId?: string;

  @ApiPropertyOptional({ description: 'Access token da Events API do TikTok (server-side, opcional)' })
  @IsOptional()
  @IsString()
  tiktokAccessToken?: string;
}
