import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class PublicDraftLineDto {
  @ApiProperty()
  @IsMongoId()
  variantId: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  quantity: number;
}

export class PublicCreateDraftDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  waId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  customerId?: string;

  @ApiPropertyOptional({
    description: 'Metadados livres (ex.: customer, shipping) para checkout público.',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class PublicPatchDraftDto {
  @ApiPropertyOptional({ type: [PublicDraftLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PublicDraftLineDto)
  lines?: PublicDraftLineDto[];

  @ApiPropertyOptional({ enum: ['collecting', 'review', 'submitted', 'assigned'] })
  @IsOptional()
  @IsEnum(['collecting', 'review', 'submitted', 'assigned'])
  status?: 'collecting' | 'review' | 'submitted' | 'assigned';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentMethodChoice?: string;

  @ApiPropertyOptional({
    description: 'Substitui ou mescla metadados do rascunho (customer, shipping, …).',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  metadata?: Record<string, unknown>;
}
