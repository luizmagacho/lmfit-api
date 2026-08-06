import { Types } from 'mongoose';
import { CountersService } from './counters.service';

/** In-memory stand-in for the single `Counter` doc a tenant+name pair maps to, mutated the
 *  same way Mongo's real `$inc` + upsert would: exactly one atomic read-modify-write per call,
 *  in call order — enough to prove `next()`'s call shape converges on strictly increasing,
 *  never-repeated values, which is the contract callers (order numbering) depend on. */
function statefulCounterModel() {
  const store = new Map<string, { seq: number }>();
  return {
    findOneAndUpdate: jest.fn(
      (filter: { tenantId: Types.ObjectId; name: string }, _update?: unknown, _options?: unknown) => {
        const key = `${filter.tenantId.toString()}:${filter.name}`;
        const existing = store.get(key) ?? { seq: 0 };
        const next = { seq: existing.seq + 1 };
        store.set(key, next);
        return { exec: jest.fn().mockResolvedValue(next) };
      },
    ),
  };
}

describe('CountersService.next — atomic per-tenant sequence (replaces countDocuments()+1 races)', () => {
  it('returns 1 for a brand-new (tenantId, name) pair', async () => {
    const model = statefulCounterModel();
    const service = new CountersService(model as any);
    const tenantId = new Types.ObjectId().toString();

    await expect(service.next(tenantId, 'order')).resolves.toBe(1);
  });

  it('returns strictly increasing, never-repeated values across N sequential calls', async () => {
    const model = statefulCounterModel();
    const service = new CountersService(model as any);
    const tenantId = new Types.ObjectId().toString();

    const results: number[] = [];
    for (let i = 0; i < 25; i++) {
      results.push(await service.next(tenantId, 'order'));
    }

    expect(results).toEqual([...Array(25)].map((_, i) => i + 1));
    expect(new Set(results).size).toBe(25);
  });

  it('keeps separate sequences per tenant — one tenant never sees another tenant’s numbers', async () => {
    const model = statefulCounterModel();
    const service = new CountersService(model as any);
    const tenantA = new Types.ObjectId().toString();
    const tenantB = new Types.ObjectId().toString();

    await service.next(tenantA, 'order');
    await service.next(tenantA, 'order');
    const bFirst = await service.next(tenantB, 'order');

    expect(bFirst).toBe(1);
  });

  it('keeps separate sequences per counter name within the same tenant', async () => {
    const model = statefulCounterModel();
    const service = new CountersService(model as any);
    const tenantId = new Types.ObjectId().toString();

    await service.next(tenantId, 'order');
    await service.next(tenantId, 'order');
    const otherName = await service.next(tenantId, 'invoice');

    expect(otherName).toBe(1);
  });

  it('issues a single atomic findOneAndUpdate with $inc + upsert (no read-then-write)', async () => {
    const model = statefulCounterModel();
    const service = new CountersService(model as any);
    const tenantId = new Types.ObjectId().toString();

    await service.next(tenantId, 'order');

    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update, options] = model.findOneAndUpdate.mock.calls[0];
    expect(filter.name).toBe('order');
    expect(update).toEqual({ $inc: { seq: 1 } });
    expect(options).toMatchObject({ upsert: true, new: true });
  });
});
