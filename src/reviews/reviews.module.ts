import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import {
  ProductVariant,
  ProductVariantSchema,
} from '../products/schemas/product-variant.schema';
import { Review, ReviewSchema } from './schemas/review.schema';
import { ReviewsController } from './reviews.controller';
import { PublicReviewsController } from './public-reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Review.name, schema: ReviewSchema },
      { name: Order.name, schema: OrderSchema },
      { name: ProductVariant.name, schema: ProductVariantSchema },
    ]),
  ],
  controllers: [ReviewsController, PublicReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
