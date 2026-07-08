import { IsString, IsOptional, IsBoolean, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { IntegrationCredentialsDto } from './create-integration.dto';

export class UpdateIntegrationDto {
  @IsOptional() @IsString() label?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => IntegrationCredentialsDto)
  credentials?: IntegrationCredentialsDto;

  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() syncProducts?: boolean;
  @IsOptional() @IsBoolean() syncStock?: boolean;
  @IsOptional() @IsBoolean() syncOrders?: boolean;
}
