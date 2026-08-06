import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class WishlistItemDto {
  @ApiProperty()
  @IsMongoId()
  productId: string;
}
