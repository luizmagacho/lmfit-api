import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class InputItemDto {
  @ApiProperty({ description: 'Descrição do insumo (ex: Malha Cotton Preta)' })
  @IsString()
  description: string;

  @ApiPropertyOptional({
    enum: ['fabric', 'lining', 'zipper', 'button', 'elastic', 'thread', 'label', 'packaging', 'other'],
  })
  @IsOptional()
  @IsEnum(['fabric', 'lining', 'zipper', 'button', 'elastic', 'thread', 'label', 'packaging', 'other'])
  inputType?: string;

  @ApiPropertyOptional({ enum: ['kg', 'm', 'm2', 'unit', 'roll', 'dozen', 'pack'] })
  @IsOptional()
  @IsEnum(['kg', 'm', 'm2', 'unit', 'roll', 'dozen', 'pack'])
  unit?: string;

  @ApiProperty({ description: 'Quantidade utilizada no lote (ex: 50 para 50kg)' })
  @IsNumber()
  @Min(0)
  quantity: number;

  @ApiProperty({ description: 'Preço por unidade (ex: 10.00 por kg)' })
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiProperty({ description: 'Custo total = quantity * unitPrice (calculado ou informado)' })
  @IsNumber()
  @Min(0)
  totalCost: number;
}

export class CreateProductionBatchDto {
  @ApiProperty({ description: 'Nome ou referência do lote (ex: Legging Preta P/M - Maio 2026)' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'SKU ou código do produto' })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiProperty({ description: 'Quantidade de peças no lote', minimum: 1 })
  @IsNumber()
  @Min(1)
  batchQty: number;

  @ApiPropertyOptional({ description: 'Status do lote (customizável pelo usuário)' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ type: [InputItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InputItemDto)
  inputs?: InputItemDto[];

  @ApiPropertyOptional({ description: 'Custo total de corte para o lote (R$)', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cuttingCost?: number;

  @ApiPropertyOptional({ description: 'Custo total de costura para o lote (R$)', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  sewingCost?: number;

  @ApiPropertyOptional({ description: 'Overhead em % sobre (MP + MO)', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  overheadPercent?: number;

  @ApiPropertyOptional({ description: 'Margem desejada para cálculo do preço sugerido (%)', default: 60 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetMarginPercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Data prevista de conclusão (ISO)' })
  @IsOptional()
  @IsString()
  dueDate?: string;
}
