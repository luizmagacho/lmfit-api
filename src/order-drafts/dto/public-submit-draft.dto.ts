import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsMongoId, IsOptional, ValidateNested } from 'class-validator';

export class PublicSubmitPaymentDto {
  // 'manual' = combinar no WhatsApp: cria o pedido sem registro de pagamento
  // (cai no branch default de submitByToken), igual a rascunhos sem payment.
  @ApiPropertyOptional({ enum: ['pix', 'infinitepay', 'manual'] })
  @IsEnum(['pix', 'infinitepay', 'manual'])
  method!: 'pix' | 'infinitepay' | 'manual';
}

export class PublicSubmitDraftDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => PublicSubmitPaymentDto)
  payment?: PublicSubmitPaymentDto;

  // Só tem efeito para um cliente logado (Loop 9) — um convidado nunca tem customerId resolvido
  // a tempo de ter um saldo de crédito de loja conhecido.
  @ApiPropertyOptional({ description: 'Aplica o saldo de crédito de loja do cliente como desconto final' })
  @IsOptional()
  @IsBoolean()
  useStoreCredit?: boolean;
}
