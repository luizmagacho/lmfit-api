import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { BrlMoney } from '../../common/money/brl-money.decorator';

export class UpdateInvoiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  number?: string;

  @ApiPropertyOptional({
    enum: ['pending', 'paid', 'overdue', 'cancelled'],
    description: 'Partial update; see GET /invoices/status-options',
  })
  @IsOptional()
  @IsEnum(['pending', 'paid', 'overdue', 'cancelled'])
  status?: 'pending' | 'paid' | 'overdue' | 'cancelled';

  @ApiPropertyOptional({ description: 'Número ou string BRL / só dígitos como centavos' })
  @IsOptional()
  @BrlMoney()
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
