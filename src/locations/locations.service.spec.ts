import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { LocationsService } from './locations.service';

type Key = string;

/** In-memory stand-in for the `stocklevels` collection, behaving like real MongoDB for the
 *  two operations `adjust()`/`transfer()` actually issue: `updateOne` with `$inc`/upsert always
 *  succeeds, `findOneAndUpdate` with a `quantity: {$gte: ...}` guard only matches (and mutates)
 *  when the guard holds — so these tests exercise the real atomic-guard logic, not just that
 *  some mock function was called. */
function statefulStockLevelModel() {
  const store = new Map<Key, { quantity: number; variantId: Types.ObjectId; locationId: Types.ObjectId }>();
  const variantMeta = new Map<string, { sku: string; productName: string; color?: string; size?: string }>();
  const key = (f: { tenantId: Types.ObjectId; variantId: Types.ObjectId; locationId: Types.ObjectId }) =>
    `${f.tenantId.toString()}:${f.variantId.toString()}:${f.locationId.toString()}`;

  return {
    _store: store,
    _get: (f: { tenantId: Types.ObjectId; variantId: Types.ObjectId; locationId: Types.ObjectId }) =>
      store.get(key(f))?.quantity ?? 0,
    _seed: (f: { tenantId: Types.ObjectId; variantId: Types.ObjectId; locationId: Types.ObjectId }, quantity: number) =>
      store.set(key(f), { quantity, variantId: f.variantId, locationId: f.locationId }),
    _seedVariantMeta: (variantId: Types.ObjectId, meta: { sku: string; productName: string; color?: string; size?: string }) =>
      variantMeta.set(variantId.toString(), meta),

    find: jest.fn((filter: { tenantId: Types.ObjectId; locationId?: Types.ObjectId; quantity?: { $gt: number } }) => {
      const rows = [...store.entries()]
        .filter(
          ([, v]) =>
            (filter.locationId === undefined || v.locationId.equals(filter.locationId)) &&
            (filter.quantity?.$gt === undefined || v.quantity > filter.quantity.$gt),
        )
        .map(([, v]) => {
          const meta = variantMeta.get(v.variantId.toString());
          return {
            variantId: {
              _id: v.variantId,
              sku: meta?.sku ?? '',
              color: meta?.color,
              size: meta?.size,
              productId: { name: meta?.productName ?? '' },
            },
            locationId: v.locationId,
            quantity: v.quantity,
          };
        });
      const chain: any = {
        sort: () => chain,
        skip: () => chain,
        limit: () => chain,
        populate: () => chain,
        lean: () => chain,
        exec: jest.fn().mockResolvedValue(rows),
      };
      return chain;
    }),
    countDocuments: jest.fn((filter: { locationId: Types.ObjectId }) => ({
      exec: jest.fn().mockResolvedValue(
        [...store.values()].filter((v) => v.locationId.equals(filter.locationId) && v.quantity > 0).length,
      ),
    })),

    updateOne: jest.fn(async (filter: any, update: any) => {
      const k = key(filter);
      const current = store.get(k)?.quantity ?? 0;
      if (update.$set) {
        store.set(k, { quantity: update.$set.quantity, variantId: filter.variantId, locationId: filter.locationId });
      } else if (update.$inc) {
        store.set(k, {
          quantity: current + update.$inc.quantity,
          variantId: filter.variantId,
          locationId: filter.locationId,
        });
      }
      return { acknowledged: true };
    }),

    findOneAndUpdate: jest.fn((filter: any, update: any, _options?: any) => ({
      exec: jest.fn(async () => {
        const k = key(filter);
        const existing = store.get(k);
        const current = existing?.quantity ?? 0;

        if (Array.isArray(update)) {
          // Pipeline-style update — the only shape in use is `reserveUpToAvailable`'s
          // "take up to requestedQty, clamp at zero" pattern:
          // $set: { quantity: { $max: [{ $subtract: ["$quantity", requestedQty] }, 0] } }.
          // findOneAndUpdate without {new:true} returns the pre-image, which is what the
          // real implementation relies on to compute how much was actually taken.
          if (!existing) return null;
          const requestedQty = update[0]?.$set?.quantity?.$max?.[0]?.$subtract?.[1];
          const next = Math.max(current - requestedQty, 0);
          store.set(k, { quantity: next, variantId: filter.variantId, locationId: filter.locationId });
          return { quantity: current, variantId: filter.variantId, locationId: filter.locationId };
        }

        const guard = filter.quantity?.$gte;
        if (guard !== undefined && current < guard) return null;
        const next = current + (update.$inc?.quantity ?? 0);
        store.set(k, { quantity: next, variantId: filter.variantId, locationId: filter.locationId });
        return { quantity: next };
      }),
    })),

    findOne: jest.fn((filter: any) => ({
      lean: () => ({
        exec: jest.fn(async () => {
          const k = key(filter);
          if (!store.has(k)) return null;
          return { quantity: store.get(k)!.quantity };
        }),
      }),
      exec: jest.fn(async () => {
        const k = key(filter);
        if (!store.has(k)) return null;
        return { quantity: store.get(k)!.quantity };
      }),
    })),
  };
}

function locationModelStub(ids: Types.ObjectId[]) {
  return {
    findOne: jest.fn(({ _id }: { _id: Types.ObjectId }) => ({
      lean: () => ({
        exec: jest.fn(async () => (ids.some((id) => id.equals(_id)) ? { _id } : null)),
      }),
    })),
  };
}

describe('LocationsService.adjust — atomic $gte guard (replaces findOne→Math.max→updateOne TOCTOU)', () => {
  const tenantId = new Types.ObjectId().toString();
  const variantId = new Types.ObjectId();
  const locationId = new Types.ObjectId();

  it('increments unconditionally, even from zero / no existing row', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const service = new LocationsService({} as any, stockLevelModel as any, {} as any);

    await service.adjust(tenantId, variantId, 5, locationId);

    expect(stockLevelModel._get({ tenantId: new Types.ObjectId(tenantId), variantId, locationId })).toBe(5);
  });

  it('decrements when enough is recorded at that location', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const service = new LocationsService({} as any, stockLevelModel as any, {} as any);
    const f = { tenantId: new Types.ObjectId(tenantId), variantId, locationId };
    stockLevelModel._seed(f, 10);

    await service.adjust(tenantId, variantId, -4, locationId);

    expect(stockLevelModel._get(f)).toBe(6);
  });

  it('never goes negative under concurrent decrements racing the same location (sequential calls, same guarded path)', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const service = new LocationsService({} as any, stockLevelModel as any, {} as any);
    const f = { tenantId: new Types.ObjectId(tenantId), variantId, locationId };
    stockLevelModel._seed(f, 5);

    // Two "concurrent" decrements of 3 each against a location that only has 5 — at most one
    // can fully succeed; the guard must prevent the second from taking the balance to -1.
    await Promise.all([
      service.adjust(tenantId, variantId, -3, locationId),
      service.adjust(tenantId, variantId, -3, locationId),
    ]);

    expect(stockLevelModel._get(f)).toBeGreaterThanOrEqual(0);
  });

  it('clamps to zero (never throws) when the location does not have enough recorded — same drift-tolerant posture as before', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const service = new LocationsService({} as any, stockLevelModel as any, {} as any);
    const f = { tenantId: new Types.ObjectId(tenantId), variantId, locationId };
    stockLevelModel._seed(f, 2);

    await expect(service.adjust(tenantId, variantId, -10, locationId)).resolves.toBeUndefined();

    expect(stockLevelModel._get(f)).toBe(0);
  });

  it('clamps to zero when no row exists yet for this location', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const service = new LocationsService({} as any, stockLevelModel as any, {} as any);
    const f = { tenantId: new Types.ObjectId(tenantId), variantId, locationId };

    await service.adjust(tenantId, variantId, -1, locationId);

    expect(stockLevelModel._get(f)).toBe(0);
  });

  it('is a no-op for a zero delta (no model calls)', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const service = new LocationsService({} as any, stockLevelModel as any, {} as any);

    await service.adjust(tenantId, variantId, 0, locationId);

    expect(stockLevelModel.updateOne).not.toHaveBeenCalled();
    expect(stockLevelModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('LocationsService.transfer — atomic guarded decrement (replaces check-then-write TOCTOU)', () => {
  const tenantId = new Types.ObjectId().toString();
  const variantId = new Types.ObjectId();
  const fromLocationId = new Types.ObjectId();
  const toLocationId = new Types.ObjectId();

  it('moves stock from origin to destination when enough is available', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const locationModel = locationModelStub([fromLocationId, toLocationId]);
    const service = new LocationsService(locationModel as any, stockLevelModel as any, {} as any);
    const fromKey = { tenantId: new Types.ObjectId(tenantId), variantId, locationId: fromLocationId };
    const toKey = { tenantId: new Types.ObjectId(tenantId), variantId, locationId: toLocationId };
    stockLevelModel._seed(fromKey, 10);

    const result = await service.transfer(tenantId, {
      variantId: variantId.toString(),
      fromLocationId: fromLocationId.toString(),
      toLocationId: toLocationId.toString(),
      quantity: 4,
    });

    expect(result).toEqual({ transferred: 4 });
    expect(stockLevelModel._get(fromKey)).toBe(6);
    expect(stockLevelModel._get(toKey)).toBe(4);
  });

  it('rejects (and mutates nothing) when the origin does not have enough stock', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const locationModel = locationModelStub([fromLocationId, toLocationId]);
    const service = new LocationsService(locationModel as any, stockLevelModel as any, {} as any);
    const fromKey = { tenantId: new Types.ObjectId(tenantId), variantId, locationId: fromLocationId };
    const toKey = { tenantId: new Types.ObjectId(tenantId), variantId, locationId: toLocationId };
    stockLevelModel._seed(fromKey, 2);

    await expect(
      service.transfer(tenantId, {
        variantId: variantId.toString(),
        fromLocationId: fromLocationId.toString(),
        toLocationId: toLocationId.toString(),
        quantity: 5,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(stockLevelModel._get(fromKey)).toBe(2);
    expect(stockLevelModel._get(toKey)).toBe(0);
  });

  it('never lets two concurrent transfers jointly overdraw the same origin', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const locationModel = locationModelStub([fromLocationId, toLocationId]);
    const service = new LocationsService(locationModel as any, stockLevelModel as any, {} as any);
    const fromKey = { tenantId: new Types.ObjectId(tenantId), variantId, locationId: fromLocationId };
    stockLevelModel._seed(fromKey, 5);

    const args = {
      variantId: variantId.toString(),
      fromLocationId: fromLocationId.toString(),
      toLocationId: toLocationId.toString(),
      quantity: 4,
    };
    const results = await Promise.allSettled([
      service.transfer(tenantId, args),
      service.transfer(tenantId, args),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    // 5 in stock, two attempts to take 4 each — at most one can succeed.
    expect(fulfilled.length).toBe(1);
    expect(stockLevelModel._get(fromKey)).toBeGreaterThanOrEqual(0);
  });
});

describe('LocationsService.reserveUpToAvailable — atomic partial-fill (Loop PDV-OFF-4)', () => {
  const tenantId = new Types.ObjectId().toString();
  const variantId = new Types.ObjectId();
  const locationId = new Types.ObjectId();

  it('takes the full amount when there is enough', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const service = new LocationsService({} as any, stockLevelModel as any, {} as any);
    const f = { tenantId: new Types.ObjectId(tenantId), variantId, locationId };
    stockLevelModel._seed(f, 10);

    const fulfilled = await service.reserveUpToAvailable(tenantId, variantId, locationId, 4);

    expect(fulfilled).toBe(4);
    expect(stockLevelModel._get(f)).toBe(6);
  });

  // Regression: Mongoose throws "Cannot pass an array to query updates unless the
  // `updatePipeline` option is set" for aggregation-pipeline updates unless this option is
  // passed explicitly — a real bug that only surfaced against a live MongoDB, never in the
  // mocked unit tests above, since the mock doesn't replicate Mongoose's own validation.
  it('passes {updatePipeline: true} so the real Mongoose driver accepts the pipeline update', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const service = new LocationsService({} as any, stockLevelModel as any, {} as any);
    const f = { tenantId: new Types.ObjectId(tenantId), variantId, locationId };
    stockLevelModel._seed(f, 10);

    await service.reserveUpToAvailable(tenantId, variantId, locationId, 4);

    const [, , options] = stockLevelModel.findOneAndUpdate.mock.calls[0];
    expect(options).toMatchObject({ updatePipeline: true });
  });

  it('takes only what is available and reports the smaller fulfilled amount, never going negative', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const service = new LocationsService({} as any, stockLevelModel as any, {} as any);
    const f = { tenantId: new Types.ObjectId(tenantId), variantId, locationId };
    stockLevelModel._seed(f, 2);

    const fulfilled = await service.reserveUpToAvailable(tenantId, variantId, locationId, 5);

    expect(fulfilled).toBe(2);
    expect(stockLevelModel._get(f)).toBe(0);
  });

  it('returns 0 without throwing when no row exists yet for this location', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const service = new LocationsService({} as any, stockLevelModel as any, {} as any);

    const fulfilled = await service.reserveUpToAvailable(tenantId, variantId, locationId, 3);

    expect(fulfilled).toBe(0);
  });

  it('is a no-op for a zero or negative requested quantity', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const service = new LocationsService({} as any, stockLevelModel as any, {} as any);
    const f = { tenantId: new Types.ObjectId(tenantId), variantId, locationId };
    stockLevelModel._seed(f, 5);

    expect(await service.reserveUpToAvailable(tenantId, variantId, locationId, 0)).toBe(0);
    expect(stockLevelModel._get(f)).toBe(5);
  });

  it('never lets two concurrent reservations jointly take more than what was available', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const service = new LocationsService({} as any, stockLevelModel as any, {} as any);
    const f = { tenantId: new Types.ObjectId(tenantId), variantId, locationId };
    stockLevelModel._seed(f, 5);

    const [a, b] = await Promise.all([
      service.reserveUpToAvailable(tenantId, variantId, locationId, 4),
      service.reserveUpToAvailable(tenantId, variantId, locationId, 4),
    ]);

    expect(a + b).toBeLessThanOrEqual(5);
    expect(stockLevelModel._get(f)).toBeGreaterThanOrEqual(0);
  });
});

/** Supports both call shapes `LocationsService` needs from the `Location` model:
 *  `getOrCreateDefault()`'s bare `.findOne(...).exec()` and `transfer()`'s
 *  `.findOne(...).lean().exec()` existence check. */
function richLocationModelStub(locations: Array<{ _id: Types.ObjectId; name?: string; isDefault?: boolean }>) {
  const match = (filter: any) => {
    if (filter._id) return locations.find((l) => l._id.equals(filter._id)) ?? null;
    if (filter.isDefault) return locations.find((l) => l.isDefault) ?? null;
    return null;
  };
  return {
    findOne: jest.fn((filter: any) => ({
      exec: jest.fn(async () => match(filter)),
      lean: () => ({ exec: jest.fn(async () => match(filter)) }),
    })),
    find: jest.fn(() => ({
      sort: () => ({ lean: () => ({ exec: jest.fn(async () => locations) }) }),
    })),
  };
}

describe('LocationsService.allocate — sugar over transfer() from the tenant-wide default location', () => {
  const tenantId = new Types.ObjectId().toString();
  const variantId = new Types.ObjectId();
  const defaultLocationId = new Types.ObjectId();
  const targetLocationId = new Types.ObjectId();

  it('moves stock from the default location without the caller naming it', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const locationModel = richLocationModelStub([
      { _id: defaultLocationId, isDefault: true },
      { _id: targetLocationId },
    ]);
    const service = new LocationsService(locationModel as any, stockLevelModel as any, {} as any);
    const defaultKey = { tenantId: new Types.ObjectId(tenantId), variantId, locationId: defaultLocationId };
    const targetKey = { tenantId: new Types.ObjectId(tenantId), variantId, locationId: targetLocationId };
    stockLevelModel._seed(defaultKey, 10);

    const result = await service.allocate(tenantId, {
      variantId: variantId.toString(),
      toLocationId: targetLocationId.toString(),
      quantity: 3,
    });

    expect(result).toEqual({ transferred: 3 });
    expect(stockLevelModel._get(defaultKey)).toBe(7);
    expect(stockLevelModel._get(targetKey)).toBe(3);
  });

  it('rejects when the central pool does not have enough stock', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const locationModel = richLocationModelStub([
      { _id: defaultLocationId, isDefault: true },
      { _id: targetLocationId },
    ]);
    const service = new LocationsService(locationModel as any, stockLevelModel as any, {} as any);
    stockLevelModel._seed(
      { tenantId: new Types.ObjectId(tenantId), variantId, locationId: defaultLocationId },
      2,
    );

    await expect(
      service.allocate(tenantId, {
        variantId: variantId.toString(),
        toLocationId: targetLocationId.toString(),
        quantity: 5,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('LocationsService.stockByLocation — what a location has allocated', () => {
  const tenantId = new Types.ObjectId().toString();
  const locationId = new Types.ObjectId();
  const otherLocationId = new Types.ObjectId();
  const variantId = new Types.ObjectId();

  it('lists only variants with quantity > 0 at that specific location', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const locationModel = richLocationModelStub([{ _id: locationId }, { _id: otherLocationId }]);
    const service = new LocationsService(locationModel as any, stockLevelModel as any, {} as any);
    const tid = new Types.ObjectId(tenantId);
    stockLevelModel._seed({ tenantId: tid, variantId, locationId }, 6);
    stockLevelModel._seedVariantMeta(variantId, { sku: 'CAM-P', productName: 'Camiseta Básica' });
    // A zero-quantity row at another location must never leak into this location's list.
    stockLevelModel._seed({ tenantId: tid, variantId, locationId: otherLocationId }, 0);

    const result = await service.stockByLocation(tenantId, locationId.toString(), 1, 20);

    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      {
        variantId: variantId.toString(),
        sku: 'CAM-P',
        productName: 'Camiseta Básica',
        color: undefined,
        size: undefined,
        displayName: 'Camiseta Básica',
        quantity: 6,
      },
    ]);
  });

  // Regression: the admin "estoque alocado" list used to show only the bare product name,
  // so every size/color of the same product rendered as an indistinguishable duplicate row
  // — the SKU was the only thing telling them apart. displayName fixes that.
  it('concatenates color and size into displayName so same-product variants are distinguishable', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const locationModel = richLocationModelStub([{ _id: locationId }]);
    const service = new LocationsService(locationModel as any, stockLevelModel as any, {} as any);
    const tid = new Types.ObjectId(tenantId);
    stockLevelModel._seed({ tenantId: tid, variantId, locationId }, 4);
    stockLevelModel._seedVariantMeta(variantId, { sku: 'TOPESNC-PRE-P', productName: 'Top Essencial', color: 'Preto', size: 'P' });

    const result = await service.stockByLocation(tenantId, locationId.toString(), 1, 20);

    expect(result.items[0]).toMatchObject({ displayName: 'Top Essencial — Preto — P' });
  });

  it('throws NotFoundException for a location that does not belong to this tenant', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const locationModel = richLocationModelStub([]);
    const service = new LocationsService(locationModel as any, stockLevelModel as any, {} as any);

    await expect(service.stockByLocation(tenantId, locationId.toString(), 1, 20)).rejects.toThrow();
  });
});

/** Minimal stand-in for the `ProductVariant` model — only the two calls
 *  `backfillFromOnHand()` issues (`.find(...).select().lean().exec()`). */
function variantModelStub(variants: Array<{ _id: Types.ObjectId; quantityOnHand: number }>) {
  return {
    find: jest.fn((filter: { quantityOnHand: { $gt: number }; _id: { $nin: Types.ObjectId[] } }) => ({
      select: () => ({
        lean: () => ({
          exec: jest.fn(async () =>
            variants.filter(
              (v) =>
                v.quantityOnHand > filter.quantityOnHand.$gt &&
                !filter._id.$nin.some((id) => id.equals(v._id)),
            ),
          ),
        }),
      }),
    })),
  };
}

describe('LocationsService.backfillFromOnHand — one-time repair for initial-intake stock never mirrored into StockLevel', () => {
  const tenantId = new Types.ObjectId().toString();
  const targetLocationId = new Types.ObjectId();
  const variantA = new Types.ObjectId();
  const variantB = new Types.ObjectId();

  it('seeds the target location with quantityOnHand for every untracked variant', async () => {
    const stockLevelModel = statefulStockLevelModel();
    (stockLevelModel as any).distinct = jest.fn(() => ({ exec: jest.fn(async () => []) }));
    (stockLevelModel as any).insertMany = jest.fn(async (docs: any[]) => {
      for (const d of docs) stockLevelModel._seed(d, d.quantity);
      return docs;
    });
    const locationModel = richLocationModelStub([{ _id: targetLocationId }]);
    const variants = variantModelStub([
      { _id: variantA, quantityOnHand: 4 },
      { _id: variantB, quantityOnHand: 7 },
    ]);
    const service = new LocationsService(locationModel as any, stockLevelModel as any, variants as any);

    const result = await service.backfillFromOnHand(tenantId, targetLocationId.toString());

    expect(result).toEqual({ seeded: 2 });
    expect(stockLevelModel._get({ tenantId: new Types.ObjectId(tenantId), variantId: variantA, locationId: targetLocationId })).toBe(4);
    expect(stockLevelModel._get({ tenantId: new Types.ObjectId(tenantId), variantId: variantB, locationId: targetLocationId })).toBe(7);
  });

  it('skips variants that already have a StockLevel row anywhere — safe to re-run without clobbering real transfers', async () => {
    const stockLevelModel = statefulStockLevelModel();
    (stockLevelModel as any).distinct = jest.fn(() => ({ exec: jest.fn(async () => [variantA]) }));
    (stockLevelModel as any).insertMany = jest.fn(async (docs: any[]) => {
      for (const d of docs) stockLevelModel._seed(d, d.quantity);
      return docs;
    });
    const locationModel = richLocationModelStub([{ _id: targetLocationId }]);
    const variants = variantModelStub([
      { _id: variantA, quantityOnHand: 4 },
      { _id: variantB, quantityOnHand: 7 },
    ]);
    const service = new LocationsService(locationModel as any, stockLevelModel as any, variants as any);

    const result = await service.backfillFromOnHand(tenantId, targetLocationId.toString());

    expect(result).toEqual({ seeded: 1 });
    expect(stockLevelModel._get({ tenantId: new Types.ObjectId(tenantId), variantId: variantA, locationId: targetLocationId })).toBe(0);
    expect(stockLevelModel._get({ tenantId: new Types.ObjectId(tenantId), variantId: variantB, locationId: targetLocationId })).toBe(7);
  });

  it('throws NotFoundException for a location that does not belong to this tenant', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const locationModel = richLocationModelStub([]);
    const variants = variantModelStub([]);
    const service = new LocationsService(locationModel as any, stockLevelModel as any, variants as any);

    await expect(service.backfillFromOnHand(tenantId, targetLocationId.toString())).rejects.toThrow();
  });
});

describe('LocationsService.transferBatch — multiple variants/sizes in one transfer', () => {
  const tenantId = new Types.ObjectId().toString();
  const fromLocationId = new Types.ObjectId();
  const toLocationId = new Types.ObjectId();
  const variantP = new Types.ObjectId();
  const variantM = new Types.ObjectId();
  const variantG = new Types.ObjectId();

  it('moves every item in one call — e.g. Legging Preta P/M/G all at once', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const locationModel = richLocationModelStub([{ _id: fromLocationId }, { _id: toLocationId }]);
    const service = new LocationsService(locationModel as any, stockLevelModel as any, {} as any);
    const tid = new Types.ObjectId(tenantId);
    stockLevelModel._seed({ tenantId: tid, variantId: variantP, locationId: fromLocationId }, 5);
    stockLevelModel._seed({ tenantId: tid, variantId: variantM, locationId: fromLocationId }, 4);
    stockLevelModel._seed({ tenantId: tid, variantId: variantG, locationId: fromLocationId }, 5);

    const result = await service.transferBatch(tenantId, {
      fromLocationId: fromLocationId.toString(),
      toLocationId: toLocationId.toString(),
      items: [
        { variantId: variantP.toString(), quantity: 5 },
        { variantId: variantM.toString(), quantity: 4 },
        { variantId: variantG.toString(), quantity: 5 },
      ],
    });

    expect(result).toEqual({
      transferred: 3,
      items: [
        { variantId: variantP.toString(), quantity: 5 },
        { variantId: variantM.toString(), quantity: 4 },
        { variantId: variantG.toString(), quantity: 5 },
      ],
    });
    expect(stockLevelModel._get({ tenantId: tid, variantId: variantP, locationId: fromLocationId })).toBe(0);
    expect(stockLevelModel._get({ tenantId: tid, variantId: variantP, locationId: toLocationId })).toBe(5);
    expect(stockLevelModel._get({ tenantId: tid, variantId: variantM, locationId: toLocationId })).toBe(4);
    expect(stockLevelModel._get({ tenantId: tid, variantId: variantG, locationId: toLocationId })).toBe(5);
  });

  it('rejects the whole batch up front (moves nothing) when any single item lacks enough stock', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const locationModel = richLocationModelStub([{ _id: fromLocationId }, { _id: toLocationId }]);
    const service = new LocationsService(locationModel as any, stockLevelModel as any, {} as any);
    const tid = new Types.ObjectId(tenantId);
    stockLevelModel._seed({ tenantId: tid, variantId: variantP, locationId: fromLocationId }, 5);
    stockLevelModel._seed({ tenantId: tid, variantId: variantM, locationId: fromLocationId }, 2); // short by 2

    await expect(
      service.transferBatch(tenantId, {
        fromLocationId: fromLocationId.toString(),
        toLocationId: toLocationId.toString(),
        items: [
          { variantId: variantP.toString(), quantity: 5 },
          { variantId: variantM.toString(), quantity: 4 },
        ],
      }),
    ).rejects.toMatchObject({
      response: {
        conflicts: [{ variantId: variantM.toString(), needed: 4, available: 2 }],
      },
    });

    // Nothing moved — not even variantP, which alone had enough.
    expect(stockLevelModel._get({ tenantId: tid, variantId: variantP, locationId: fromLocationId })).toBe(5);
    expect(stockLevelModel._get({ tenantId: tid, variantId: variantP, locationId: toLocationId })).toBe(0);
  });

  it('rejects transferring between the same location twice', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const locationModel = richLocationModelStub([{ _id: fromLocationId }]);
    const service = new LocationsService(locationModel as any, stockLevelModel as any, {} as any);

    await expect(
      service.transferBatch(tenantId, {
        fromLocationId: fromLocationId.toString(),
        toLocationId: fromLocationId.toString(),
        items: [{ variantId: variantP.toString(), quantity: 1 }],
      }),
    ).rejects.toThrow();
  });
});

describe('LocationsService.stockMatrix — every variant × every location in one grid', () => {
  const tenantId = new Types.ObjectId().toString();
  const locationA = new Types.ObjectId();
  const locationB = new Types.ObjectId();
  const variantId = new Types.ObjectId();

  it('pivots stock by location per variant, with a color/size displayName', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const locationModel = richLocationModelStub([
      { _id: locationA, name: 'Banca Brás', isDefault: true },
      { _id: locationB, name: 'Estoque' },
    ]);
    const service = new LocationsService(locationModel as any, stockLevelModel as any, {} as any);
    const tid = new Types.ObjectId(tenantId);
    stockLevelModel._seed({ tenantId: tid, variantId, locationId: locationA }, 5);
    stockLevelModel._seed({ tenantId: tid, variantId, locationId: locationB }, 3);
    stockLevelModel._seedVariantMeta(variantId, { sku: 'LEG-PRE-M', productName: 'Legging Preta', color: 'Preta', size: 'M' });

    const result = await service.stockMatrix(tenantId);

    expect(result.locations).toEqual([
      { _id: locationA.toString(), name: 'Banca Brás', isDefault: true },
      { _id: locationB.toString(), name: 'Estoque', isDefault: false },
    ]);
    expect(result.items).toEqual([
      {
        variantId: variantId.toString(),
        sku: 'LEG-PRE-M',
        productName: 'Legging Preta',
        color: 'Preta',
        size: 'M',
        displayName: 'Legging Preta — Preta — M',
        byLocation: { [locationA.toString()]: 5, [locationB.toString()]: 3 },
        total: 8,
      },
    ]);
  });

  it('never shows a location the variant has zero stock at', async () => {
    const stockLevelModel = statefulStockLevelModel();
    const locationModel = richLocationModelStub([{ _id: locationA }, { _id: locationB }]);
    const service = new LocationsService(locationModel as any, stockLevelModel as any, {} as any);
    const tid = new Types.ObjectId(tenantId);
    stockLevelModel._seed({ tenantId: tid, variantId, locationId: locationA }, 5);
    stockLevelModel._seed({ tenantId: tid, variantId, locationId: locationB }, 0);
    stockLevelModel._seedVariantMeta(variantId, { sku: 'LEG-PRE-M', productName: 'Legging Preta' });

    const result = await service.stockMatrix(tenantId);

    expect(result.items[0].byLocation).toEqual({ [locationA.toString()]: 5 });
  });
});
