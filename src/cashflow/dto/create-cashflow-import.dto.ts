import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import type { TransactionType } from '../schemas/cashflow-entry.schema';

export class CashflowTransactionDto {
  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  hour?: string;

  @IsEnum(['deposit_sales', 'pix_received', 'pix_sent', 'other'])
  type: TransactionType;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  detail?: string;

  @IsNumber()
  amount: number;
}

export class CreateCashflowImportDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CashflowTransactionDto)
  transactions: CashflowTransactionDto[];

  @IsOptional()
  @IsDateString()
  periodFrom?: string;

  @IsOptional()
  @IsDateString()
  periodTo?: string;

  @IsOptional()
  @IsString()
  source?: string;

  /** If true, also triggers Gemini AI analysis for every transaction */
  @IsOptional()
  analyzeWithAi?: boolean;
}
