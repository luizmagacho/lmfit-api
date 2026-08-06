import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateWhatsappSenderDto {
  @ApiProperty({ description: 'Número de WhatsApp do vendedor, com DDI (ex: 5511999998888)' })
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  waId: string;

  @ApiPropertyOptional({ description: 'Nome pra identificar quem é esse número' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({ description: 'Usuário do sistema vinculado — resolve a loja/local da venda por voz' })
  @IsOptional()
  @IsMongoId()
  linkedUserId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  allowed?: boolean;
}
