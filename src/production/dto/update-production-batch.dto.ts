import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateProductionBatchDto } from './create-production-batch.dto';

export class UpdateProductionBatchDto extends PartialType(CreateProductionBatchDto) {
  @ApiPropertyOptional({ description: 'Status do Kanban (customizável pelo usuário)' })
  @IsOptional()
  @IsString()
  status?: string;
}
