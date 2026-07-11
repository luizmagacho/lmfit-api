import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CashflowEntry, CashflowEntrySchema } from './schemas/cashflow-entry.schema';
import { CashflowService } from './cashflow.service';
import { CashflowController } from './cashflow.controller';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CashflowEntry.name, schema: CashflowEntrySchema },
    ]),
    LlmModule,
  ],
  controllers: [CashflowController],
  providers: [CashflowService],
  exports: [CashflowService],
})
export class CashflowModule {}
