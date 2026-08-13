import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { QuoteShippingDto } from './dto/quote-shipping.dto';
import { ShippingQuoteService } from './shipping-quote.service';

@ApiTags('public-shipping')
@Controller('public/shipping')
export class PublicShippingController {
  constructor(private readonly quotes: ShippingQuoteService) {}

  @Post('quote')
  quote(@TenantId() tenantId: string, @Body() dto: QuoteShippingDto) {
    return this.quotes.quote(tenantId, dto.destinationCep, dto.lines);
  }
}
