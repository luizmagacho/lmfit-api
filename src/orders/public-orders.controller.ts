import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CreatePublicOrderDto } from './dto/create-public-order.dto';
import { OrdersService } from './orders.service';

@ApiTags('public-orders')
@Controller('public/orders')
export class PublicOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post()
  create(@Body() dto: CreatePublicOrderDto) {
    return this.orders.createFromPublic(dto);
  }
}
