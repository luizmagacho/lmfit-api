import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Counter } from './counter.schema';

@Injectable()
export class CountersService {
  constructor(@InjectModel(Counter.name) private readonly model: Model<Counter>) {}

  /** Atomically returns the next value of the named sequence for this tenant. */
  async next(tenantId: string, name: string): Promise<number> {
    const doc = await this.model
      .findOneAndUpdate(
        { tenantId: new Types.ObjectId(tenantId), name },
        { $inc: { seq: 1 } },
        { upsert: true, new: true },
      )
      .exec();
    return doc.seq;
  }
}
