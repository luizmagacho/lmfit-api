import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ORDER_CHANNELS } from '../types/order-channel';
import { OrderLineInputDto } from './order-line-input.dto';

export class PublicOrderPaymentDto {
  @ApiProperty({ enum: ['pix'] })
  @IsEnum(['pix'])
  method: 'pix';
}

export class CreatePublicOrderDto {
  @ApiProperty()
  @IsMongoId()
  customerId: string;

  @ApiProperty({ type: [OrderLineInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  lines: OrderLineInputDto[];

  @ApiPropertyOptional({ enum: ORDER_CHANNELS })
  @IsOptional()
  @IsEnum(ORDER_CHANNELS)
  channel?: (typeof ORDER_CHANNELS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => PublicOrderPaymentDto)
  payment?: PublicOrderPaymentDto;
}
