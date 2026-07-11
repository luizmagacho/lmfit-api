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

  @ApiPropertyOptional({ description: 'Método de frete escolhido (pickup, standard, express).' })
  @IsOptional()
  @IsString()
  shippingMethod?: string;

  @ApiPropertyOptional({ description: 'Valor do frete calculado no front, aplicado ao total no submit.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  shippingCost?: number;

  @ApiPropertyOptional({
    description:
      'Código do cupom a aplicar. Envie string vazia pra remover. O desconto nunca vem do client — é sempre recalculado no servidor a partir da regra cadastrada.',
  })
  @IsOptional()
  @IsString()
  couponCode?: string;

  @ApiPropertyOptional({
    description: 'Substitui ou mescla metadados do rascunho (customer, shipping, …).',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  metadata?: Record<string, unknown>;
}
