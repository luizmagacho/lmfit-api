import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { BrlMoney } from '../../common/money/brl-money.decorator';
import { ORDER_CHANNELS } from '../types/order-channel';
import { OrderLineInputDto } from './order-line-input.dto';

export class UpdateOrderDto {
  @ApiPropertyOptional({
    enum: ORDER_CHANNELS,
    description: 'Canal: presencial, online, site ou WhatsApp',
  })
  @IsOptional()
  @IsEnum(ORDER_CHANNELS)
  channel?: (typeof ORDER_CHANNELS)[number];

  @ApiPropertyOptional({
    enum: ['open', 'picking', 'shipped', 'completed', 'cancelled', 'encomendado_pago', 'encomendado_nao_pago'],
  })
  @IsOptional()
  @IsEnum(['open', 'picking', 'shipped', 'completed', 'cancelled', 'encomendado_pago', 'encomendado_nao_pago'])
  status?: 'open' | 'picking' | 'shipped' | 'completed' | 'cancelled' | 'encomendado_pago' | 'encomendado_nao_pago';

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  operatorUserId?: string;

  @ApiPropertyOptional({ enum: ['pix', 'cash', 'card'] })
  @IsOptional()
  @IsEnum(['pix', 'cash', 'card'])
  paymentMethod?: 'pix' | 'cash' | 'card';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({ description: 'Número ou string BRL / só dígitos como centavos' })
  @IsOptional()
  @BrlMoney()
  @IsNumber()
  @Min(0)
  total?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [OrderLineInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  lines?: OrderLineInputDto[];

  @ApiPropertyOptional({ description: 'Transportadora (ex.: Correios, Jadlog)' })
  @IsOptional()
  @IsString()
  carrier?: string;

  @ApiPropertyOptional({ description: 'Código de rastreio real' })
  @IsOptional()
  @IsString()
  trackingCode?: string;

  @ApiPropertyOptional({ description: 'URL de rastreio (site da transportadora)' })
  @IsOptional()
  @IsString()
  trackingUrl?: string;
}
