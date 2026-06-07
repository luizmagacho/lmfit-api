import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Tenant, TenantSchema } from './schemas/tenant.schema';
import { TenantsController, PublicTenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Tenant.name, schema: TenantSchema }]),
  ],
  controllers: [TenantsController, PublicTenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
