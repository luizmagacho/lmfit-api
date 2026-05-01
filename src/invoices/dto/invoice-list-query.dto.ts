import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class InvoiceListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ['pending', 'paid', 'overdue', 'cancelled'],
    description: 'Filter by canonical status (legacy open/void not matched here)',
  })
  @IsOptional()
  @IsEnum(['pending', 'paid', 'overdue', 'cancelled'])
  status?: 'pending' | 'paid' | 'overdue' | 'cancelled';
}
