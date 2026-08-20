import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Customer, CustomerSchema } from './schemas/customer.schema';
import { Counter, CounterSchema } from '../common/counters/counter.schema';
import { CountersService } from '../common/counters/counters.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: Counter.name, schema: CounterSchema },
    ]),
  ],
  controllers: [CustomersController],
  providers: [CustomersService, CountersService],
  exports: [CustomersService],
})
export class CustomersModule {}
