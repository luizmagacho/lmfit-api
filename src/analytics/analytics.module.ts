import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [TenantsModule],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
