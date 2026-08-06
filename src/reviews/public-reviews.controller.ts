import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { ReviewsService } from './reviews.service';

@Throttle({ default: { limit: 1000, ttl: 60_000 } })
@ApiTags('public-reviews')
@Controller('public/reviews')
export class PublicReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  listApprovedForProduct(@Query('productId') productId: string, @TenantId() tenantId: string) {
    return this.reviews.listApprovedForProduct(tenantId, productId);
  }
}
