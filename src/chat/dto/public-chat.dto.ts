import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ChatMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  content: string;
}

/** Minimal cart-line summary the client reports so the assistant can reference
 * what's already in the cart (e.g. to remove an item) — informational only,
 * never trusted for pricing/stock (that's always re-derived from the catalog). */
export class ChatCartLineDto {
  @ApiProperty()
  @IsMongoId()
  variantId: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  productName: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  @Max(9999)
  quantity: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isOrder?: boolean;
}

export class PublicChatDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message: string;

  @ApiPropertyOptional({ type: [ChatMessageDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];

  @ApiPropertyOptional({ type: [ChatCartLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ChatCartLineDto)
  cartLines?: ChatCartLineDto[];
}
