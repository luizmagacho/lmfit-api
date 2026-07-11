import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { Tenant, TenantSchema } from '../tenants/schemas/tenant.schema';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: Tenant.name, schema: TenantSchema },
    ]),
  ],
  controllers: [LoyaltyController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
