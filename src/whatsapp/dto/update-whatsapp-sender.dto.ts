import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateWhatsappSenderDto {
  @ApiPropertyOptional({ description: 'Nome pra identificar quem é esse número' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({
    description: 'Usuário do sistema vinculado — resolve a loja/local da venda por voz. String vazia desvincula.',
  })
  @IsOptional()
  @IsString()
  linkedUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowed?: boolean;
}
