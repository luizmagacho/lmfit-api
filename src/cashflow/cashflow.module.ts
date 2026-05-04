import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CashflowEntry, CashflowEntrySchema } from './schemas/cashflow-entry.schema';
import { CashflowService } from './cashflow.service';
import { CashflowController } from './cashflow.controller';
import { GeminiModule } from '../gemini/gemini.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CashflowEntry.name, schema: CashflowEntrySchema },
    ]),
    GeminiModule,
  ],
  controllers: [CashflowController],
  providers: [CashflowService],
  exports: [CashflowService],
})
export class CashflowModule {}
