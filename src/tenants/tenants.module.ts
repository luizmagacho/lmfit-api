import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Tenant, TenantSchema } from './schemas/tenant.schema';
import { TenantRequest, TenantRequestSchema } from './schemas/tenant-request.schema';
import { TenantsController, PublicTenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Tenant.name, schema: TenantSchema },
      { name: TenantRequest.name, schema: TenantRequestSchema },
    ]),
  ],
  controllers: [TenantsController, PublicTenantsController],
  providers: [TenantsService],
  exports: [TenantsService, MongooseModule],
})
export class TenantsModule {}
