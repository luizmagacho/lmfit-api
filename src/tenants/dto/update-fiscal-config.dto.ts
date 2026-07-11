import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateFiscalConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cnpj?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  inscricaoEstadual?: string;

  @ApiPropertyOptional({ enum: ['simples_nacional', 'lucro_presumido', 'lucro_real'] })
  @IsOptional()
  @IsIn(['simples_nacional', 'lucro_presumido', 'lucro_real'])
  regimeTributario?: 'simples_nacional' | 'lucro_presumido' | 'lucro_real';

  @ApiPropertyOptional({ enum: ['homologacao', 'producao'] })
  @IsOptional()
  @IsIn(['homologacao', 'producao'])
  ambiente?: 'homologacao' | 'producao';

  @ApiPropertyOptional({ description: 'Token do emitente no painel Focus NFe' })
  @IsOptional()
  @IsString()
  focusNfeToken?: string;

  /** @deprecated Nuvem Fiscal descontinuada — aceito só por retrocompatibilidade. */
  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  @IsString()
  nuvemFiscalClientId?: string;

  /** @deprecated ver `nuvemFiscalClientId`. */
  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  @IsString()
  nuvemFiscalClientSecret?: string;
}
