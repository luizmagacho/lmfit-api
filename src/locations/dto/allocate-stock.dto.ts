import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsMongoId, Min } from 'class-validator';

/** Sugar over `TransferStockDto`: moves stock from the tenant's central/default
 *  location into a specific one, without the caller needing to know/send the
 *  default location's id. */
export class AllocateStockDto {
  @ApiProperty()
  @IsMongoId()
  variantId: string;

  @ApiProperty()
  @IsMongoId()
  toLocationId: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  quantity: number;
}
