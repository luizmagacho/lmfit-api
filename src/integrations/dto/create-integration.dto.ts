import { IsString, IsEnum, IsOptional, IsBoolean, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { IntegrationPlatform } from '../schemas/integration.schema';

export class IntegrationCredentialsDto {
  @IsOptional() @IsString() accessToken?: string;
  @IsOptional() @IsString() apiKey?: string;
  @IsOptional() @IsString() applicationKey?: string;
  @IsOptional() @IsString() storeId?: string;
  @IsOptional() @IsString() storeDomain?: string;
}

export class CreateIntegrationDto {
  @IsEnum(['bagy', 'nuvemshop', 'tray', 'loja_integrada', 'shopify', 'mercadolivre', 'shopee'])
  platform: IntegrationPlatform;

  @IsString()
  label: string;

  @ValidateNested()
  @Type(() => IntegrationCredentialsDto)
  credentials: IntegrationCredentialsDto;

  @IsOptional() @IsBoolean() syncProducts?: boolean;
  @IsOptional() @IsBoolean() syncStock?: boolean;
  @IsOptional() @IsBoolean() syncOrders?: boolean;
}
