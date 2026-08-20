import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import type { ShippingCarrierAmbiente } from '../schemas/tenant.schema';

/** Loop 27 — mesmo shape de `customers/schemas/address.schema.ts`, sem `label`. */
export class UpdateShippingOriginAddressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cep?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  logradouro?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  numero?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  complemento?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bairro?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cidade?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  uf?: string;
}

export class UpdateShippingConfigDto {
  @ApiPropertyOptional({ description: 'Rótulo exibido para a opção de retirada em loja' })
  @IsOptional()
  @IsString()
  pickupLabel?: string;

  @ApiPropertyOptional({ description: 'Taxa fixa da entrega padrão' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  standardFee?: number;

  @ApiPropertyOptional({ description: 'Taxa fixa da entrega expressa' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  expressFee?: number;

  @ApiPropertyOptional({ description: 'Subtotal a partir do qual standard/express ficam grátis (0/vazio = sem isenção)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  freeAboveTotal?: number;

  @ApiPropertyOptional({ type: UpdateShippingOriginAddressDto, description: 'Endereço de origem da loja — obrigatório pra cotação real de frete (Loop 27)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateShippingOriginAddressDto)
  originAddress?: UpdateShippingOriginAddressDto;

  // Loop 27 — token da Melhor Envio NUNCA é devolvido em texto puro pro cliente (GET /tenants/:id
  // continua devolvendo o valor criptografado como veio do banco — ver decisão equivalente já
  // documentada pra metaAppSecret/etc.). Enviar string vazia/omitir preserva o token já salvo;
  // só um valor novo de verdade substitui o anterior.
  @ApiPropertyOptional({ description: 'Token da Melhor Envio (escopo "Cotação de fretes") — só enviar quando estiver trocando o token' })
  @IsOptional()
  @IsString()
  melhorEnvioToken?: string;

  @ApiPropertyOptional({ enum: ['sandbox', 'producao'] })
  @IsOptional()
  @IsEnum(['sandbox', 'producao'])
  melhorEnvioAmbiente?: ShippingCarrierAmbiente;
}
