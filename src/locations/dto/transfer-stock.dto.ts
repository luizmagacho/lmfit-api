import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsMongoId, Min } from 'class-validator';

export class TransferStockDto {
  @ApiProperty()
  @IsMongoId()
  variantId: string;

  @ApiProperty()
  @IsMongoId()
  fromLocationId: string;

  @ApiProperty()
  @IsMongoId()
  toLocationId: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  quantity: number;
}
