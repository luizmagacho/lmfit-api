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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nuvemFiscalClientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nuvemFiscalClientSecret?: string;
}
