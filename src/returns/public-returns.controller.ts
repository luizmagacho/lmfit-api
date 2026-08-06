import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { TenantsService } from '../tenants/tenants.service';
import { ReturnsService } from './returns.service';
import { PublicReturnLookupDto, PublicReturnRequestDto } from './dto/create-return.dto';

const DEFAULT_WINDOW_DAYS = 30;

@ApiTags('public-returns')
@Controller('public/returns')
export class PublicReturnsController {
  constructor(
    private readonly returns: ReturnsService,
    private readonly tenants: TenantsService,
  ) {}

  // Loop 10 — orderNumber+phone é uma dupla enumerável (mesmo formato de "login"); mesmo teto de
  // auth.controller.ts's login (15/min) em vez do limite geral de 120/min.
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('lookup')
  async lookup(@Body() dto: PublicReturnLookupDto, @TenantId() tenantId: string) {
    const order = await this.returns.resolveOrderForGuest(tenantId, dto.orderNumber, dto.phone);
    const tenant = await this.tenants.findById(tenantId);
    const windowDays = tenant?.storefront?.returnPolicy?.windowDays ?? DEFAULT_WINDOW_DAYS;
    const orderCreatedAt = (order as unknown as { createdAt: Date }).createdAt;
    const daysSince = (Date.now() - new Date(orderCreatedAt).getTime()) / (1000 * 60 * 60 * 24);
    return {
      orderNumber: order.number,
      status: order.status,
      createdAt: orderCreatedAt,
      lines: this.returns.returnableLinesOf(order),
      withinWindow: daysSince <= windowDays,
      windowDays,
    };
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('request')
  async request(@Body() dto: PublicReturnRequestDto, @TenantId() tenantId: string) {
    const order = await this.returns.resolveOrderForGuest(tenantId, dto.orderNumber, dto.phone);
    return this.returns.requestFromCustomer(tenantId, String(order.customerId), String(order._id), dto);
  }
}
