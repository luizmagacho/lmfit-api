import { Global, Module } from '@nestjs/common';
import { ExcelSpreadsheetService } from './excel-spreadsheet.service';

@Global()
@Module({
  providers: [ExcelSpreadsheetService],
  exports: [ExcelSpreadsheetService],
})
export class ExcelModule {}
