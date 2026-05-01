import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsMongoId, IsOptional, IsString, ValidateNested } from 'class-validator';
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
