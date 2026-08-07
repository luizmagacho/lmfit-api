import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsMongoId, Min, ValidateNested } from 'class-validator';

export class TransferBatchItemDto {
  @ApiProperty()
  @IsMongoId()
  variantId: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  quantity: number;
}

/** Moves several variants (any mix of sizes/colors, across any mix of products) between two
 *  locations in a single request — e.g. "manda Legging Preta P/M/G/GG + Legging Branca P/M
 *  tudo pra Banca Brás de uma vez", instead of one call per SKU. */
export class TransferBatchStockDto {
  @ApiProperty()
  @IsMongoId()
  fromLocationId: string;

  @ApiProperty()
  @IsMongoId()
  toLocationId: string;

  @ApiProperty({ type: [TransferBatchItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TransferBatchItemDto)
  items: TransferBatchItemDto[];
}
