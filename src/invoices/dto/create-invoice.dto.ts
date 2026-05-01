import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { BrlMoney } from '../../common/money/brl-money.decorator';

export class CreateInvoiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  number?: string;

  @ApiPropertyOptional({
    enum: ['pending', 'paid', 'overdue', 'cancelled'],
    description:
      'Pendente, Paga, Vencida, Cancelada — see GET /invoices/status-options for PT-BR labels',
  })
  @IsOptional()
  @IsEnum(['pending', 'paid', 'overdue', 'cancelled'])
  status?: 'pending' | 'paid' | 'overdue' | 'cancelled';

  @ApiProperty({ default: 0, description: 'Número ou string BRL / só dígitos como centavos' })
  @BrlMoney()
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  orderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  purchaseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
