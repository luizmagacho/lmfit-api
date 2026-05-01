import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ORDER_CHANNELS } from '../types/order-channel';

export class OrderListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ORDER_CHANNELS })
  @IsOptional()
  @IsEnum(ORDER_CHANNELS)
  channel?: (typeof ORDER_CHANNELS)[number];
}
