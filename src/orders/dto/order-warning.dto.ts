import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Returned on create/update/find when the order can proceed but staff should see alerts. */
export class OrderWarningDto {
  @ApiProperty()
  variantId: string;

  @ApiProperty({ enum: ['shortfall', 'pending_purchase'] })
  type: 'shortfall' | 'pending_purchase';

  @ApiProperty()
  messagePtBr: string;

  @ApiProperty()
  suggestCreatePurchase: boolean;

  @ApiPropertyOptional()
  shortfall?: number;

  @ApiPropertyOptional()
  pendingPurchaseQty?: number;
}
