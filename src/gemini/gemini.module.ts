import { Module } from '@nestjs/common';
import { GeminiService } from './gemini.service';

import { MongooseModule } from '@nestjs/mongoose';
import { Tenant, TenantSchema } from '../tenants/schemas/tenant.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Tenant.name, schema: TenantSchema }]),
  ],
  providers: [GeminiService],
  exports: [GeminiService],
})
export class GeminiModule {}
