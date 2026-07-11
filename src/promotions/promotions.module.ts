import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Promotion, PromotionSchema } from './schemas/promotion.schema';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Promotion.name, schema: PromotionSchema }])],
  controllers: [PromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
