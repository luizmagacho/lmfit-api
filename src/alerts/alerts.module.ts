import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductsModule } from '../products/products.module';
import { LowStockAlert, LowStockAlertSchema } from './schemas/low-stock-alert.schema';
import { LowStockCron } from './low-stock.cron';

@Module({
  imports: [
    ProductsModule,
    MongooseModule.forFeature([
      { name: LowStockAlert.name, schema: LowStockAlertSchema },
    ]),
  ],
  providers: [LowStockCron],
})
export class AlertsModule {}
