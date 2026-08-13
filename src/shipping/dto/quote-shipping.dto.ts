import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsMongoId, IsNumber, IsString, Matches, Min, ValidateNested } from 'class-validator';

export class ShippingQuoteLineDto {
  @ApiProperty()
  @IsMongoId()
  variantId: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  quantity: number;
}

export class QuoteShippingDto {
  @ApiProperty({ description: 'CEP de destino, só dígitos ou com hífen', example: '80010000' })
  @IsString()
  @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP inválido' })
  destinationCep: string;

  @ApiProperty({ type: [ShippingQuoteLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ShippingQuoteLineDto)
  lines: ShippingQuoteLineDto[];
}
