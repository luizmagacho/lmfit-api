import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
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
  @Max(9999)
  quantity: number;
}

export class PublicCreateDraftDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
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
  @ArrayMaxSize(100)
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
  @MaxLength(100)
  paymentMethodChoice?: string;

  @ApiPropertyOptional({ enum: ['pickup', 'standard', 'express'] })
  @IsOptional()
  @IsEnum(['pickup', 'standard', 'express'])
  shippingMethod?: 'pickup' | 'standard' | 'express';

  // Sem campo de shippingCost aqui de propósito: o valor nunca vem do cliente (Loop 3) — é sempre
  // recalculado no servidor a partir de shippingMethod + shippingConfig do tenant + subtotal
  // (mesma lógica do couponCode, que já seguia esse princípio). Com `whitelist: true` no
  // ValidationPipe global, um shippingCost enviado no body é descartado antes de chegar aqui.

  @ApiPropertyOptional({
    description:
      'Código do cupom a aplicar. Envie string vazia pra remover. O desconto nunca vem do client — é sempre recalculado no servidor a partir da regra cadastrada.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  couponCode?: string;

  @ApiPropertyOptional({
    description: 'Substitui ou mescla metadados do rascunho (customer, shipping, …).',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  metadata?: Record<string, unknown>;
}
