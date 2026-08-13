import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateOrderDto {
  @ApiProperty()
  @IsMongoId()
  customerId: string;

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

  @ApiPropertyOptional({ description: 'PDV: operador logado' })
  @IsOptional()
  @IsMongoId()
  operatorUserId?: string;

  @ApiPropertyOptional({ description: 'Local de venda (PDV offline); normalmente resolvido do usuário logado, não enviado pelo cliente' })
  @IsOptional()
  @IsMongoId()
  locationId?: string;

  @ApiPropertyOptional({ enum: ['pix', 'cash', 'card'] })
  @IsOptional()
  @IsEnum(['pix', 'cash', 'card'])
  paymentMethod?: 'pix' | 'cash' | 'card';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({ default: 0, description: 'Número ou string BRL / só dígitos como centavos' })
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shippingMethod?: string;

  @ApiPropertyOptional({ default: 0, description: 'Número ou string BRL / só dígitos como centavos' })
  @IsOptional()
  @BrlMoney()
  @IsNumber()
  @Min(0)
  shippingCost?: number;

  @ApiPropertyOptional({ description: 'Rótulo legível da cotação real da Melhor Envio (Loop 27), ex. "PAC (Correios)"' })
  @IsOptional()
  @IsString()
  shippingServiceLabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  couponCode?: string;

  @ApiPropertyOptional({ default: 0, description: 'Desconto já validado pelo módulo promotions' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountTotal?: number;

  @ApiPropertyOptional({ default: 0, description: 'Crédito de loja já deduzido atomicamente do cliente' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  creditApplied?: number;
}
