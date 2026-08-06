import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Promotion, PromotionSchema } from '../promotions/schemas/promotion.schema';
import { Influencer, InfluencerSchema } from './schemas/influencer.schema';
import { InfluencersController } from './influencers.controller';
import { InfluencersService } from './influencers.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Influencer.name, schema: InfluencerSchema },
      { name: Promotion.name, schema: PromotionSchema },
    ]),
  ],
  controllers: [InfluencersController],
  providers: [InfluencersService],
  exports: [InfluencersService],
})
export class InfluencersModule {}
