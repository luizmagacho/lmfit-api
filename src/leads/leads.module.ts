import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { ProductLead, ProductLeadSchema } from './schemas/product-lead.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: ProductLead.name, schema: ProductLeadSchema }])],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
