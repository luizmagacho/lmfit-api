import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsMongoId, IsOptional, ValidateNested } from 'class-validator';

export class PublicSubmitPaymentDto {
  @ApiPropertyOptional({ enum: ['pix'] })
  @IsEnum(['pix'])
  method!: 'pix';
}

export class PublicSubmitDraftDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => PublicSubmitPaymentDto)
  payment?: PublicSubmitPaymentDto;
}
