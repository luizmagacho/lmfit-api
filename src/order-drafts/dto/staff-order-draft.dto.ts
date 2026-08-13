import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsMongoId, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { PublicCreateDraftDto, PublicDraftLineDto } from './public-patch-draft.dto';

/** Staff POST /order-drafts — same writable fields as public draft creation */
export class CreateStaffOrderDraftDto extends PublicCreateDraftDto {}

/** Staff PATCH /order-drafts/:id — :id is sessionToken; partial updates */
export class StaffPatchOrderDraftDto {
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

  // Loop 27: string livre (não mais um enum fechado) pra também aceitar o id de uma cotação real
  // da Melhor Envio ("me:<id>") — mesmo motivo do campo equivalente em PublicPatchDraftDto. O staff
  // sempre usa `trustClientShipping: true` (vê `patchForStaff` abaixo), então esse campo nunca passa
  // pela validação de cotação real; o tipo só precisa bater com o de `PublicPatchDraftDto` porque
  // `patchByToken` reaproveita este mesmo `applyDraftPatch()` fazendo um cast pra este DTO.
  @ApiPropertyOptional({ enum: ['pickup', 'standard', 'express'] })
  @IsOptional()
  @IsString()
  shippingMethod?: string;

  @ApiPropertyOptional({ description: 'CEP de destino — só relevante quando shippingMethod é uma cotação real ("me:*").' })
  @IsOptional()
  @IsString()
  destinationCep?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  shippingCost?: number;

  @ApiPropertyOptional({ description: 'Código do cupom — desconto recalculado no servidor.' })
  @IsOptional()
  @IsString()
  couponCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  waId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  assignedSalesUserId?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  metadata?: Record<string, unknown>;
}
