import { PartialType } from '@nestjs/swagger';
import { CreateCashflowEntryDto } from './create-cashflow-entry.dto';

export class UpdateCashflowEntryDto extends PartialType(CreateCashflowEntryDto) {}
