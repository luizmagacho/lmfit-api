import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Location, LocationDocument } from './schemas/location.schema';
import { StockLevel } from './schemas/stock-level.schema';
import { ProductVariant } from '../products/schemas/product-variant.schema';
import type { CreateLocationDto } from './dto/create-location.dto';
import type { UpdateLocationDto } from './dto/update-location.dto';
import type { TransferStockDto } from './dto/transfer-stock.dto';
import type { AllocateStockDto } from './dto/allocate-stock.dto';
import type { TransferBatchStockDto } from './dto/transfer-batch-stock.dto';

const DEFAULT_LOCATION_NAME = 'Loja Principal';

@Injectable()
export class LocationsService {
  constructor(
    @InjectModel(Location.name) private readonly model: Model<Location>,
    @InjectModel(StockLevel.name) private readonly stockLevelModel: Model<StockLevel>,
    @InjectModel(ProductVariant.name) private readonly variantModel: Model<ProductVariant>,
  ) {}

  /** Every tenant gets exactly one default location, created lazily on first use. */
  async getOrCreateDefault(tenantId: string): Promise<LocationDocument> {
    const tid = new Types.ObjectId(tenantId);
    const existing = await this.model.findOne({ tenantId: tid, isDefault: true }).exec();
    if (existing) return existing;
    return this.model.create({
      tenantId: tid,
      name: DEFAULT_LOCATION_NAME,
      isDefault: true,
      active: true,
    });
  }

  async create(tenantId: string, dto: CreateLocationDto) {
    const tid = new Types.ObjectId(tenantId);
    try {
      if (dto.isDefault) {
        await this.model.updateMany({ tenantId: tid, isDefault: true }, { $set: { isDefault: false } });
      }
      return await this.model.create({
        tenantId: tid,
        name: dto.name.trim(),
        address: dto.address?.trim(),
        isDefault: !!dto.isDefault,
        active: true,
      });
    } catch (e: any) {
      if (e?.code === 11000) {
        throw new ConflictException('Já existe um local com esse nome');
      }
      throw e;
    }
  }

  async findAll(tenantId: string) {
    const items = await this.model
      .find({ tenantId: new Types.ObjectId(tenantId) })
      .sort({ isDefault: -1, name: 1 })
      .lean()
      .exec();
    return { items, total: items.length };
  }

  async findOne(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model
      .findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) })
      .lean()
      .exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async update(tenantId: string, id: string, dto: UpdateLocationDto) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const tid = new Types.ObjectId(tenantId);
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.address !== undefined) patch.address = dto.address?.trim();
    if (dto.active !== undefined) patch.active = dto.active;
    if (dto.isDefault !== undefined) {
      if (dto.isDefault) {
        await this.model.updateMany({ tenantId: tid, isDefault: true, _id: { $ne: id } }, { $set: { isDefault: false } });
      }
      patch.isDefault = dto.isDefault;
    }
    const doc = await this.model.findOneAndUpdate({ _id: id, tenantId: tid }, patch, { new: true }).exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async remove(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model.findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) }).exec();
    if (!doc) throw new NotFoundException();
    if (doc.isDefault) {
      throw new BadRequestException('O local padrão não pode ser removido');
    }
    const hasStock = await this.stockLevelModel.exists({
      tenantId: new Types.ObjectId(tenantId),
      locationId: doc._id,
      quantity: { $gt: 0 },
    });
    if (hasStock) {
      throw new BadRequestException('Transfira o estoque deste local antes de removê-lo');
    }
    // Drop any zero-quantity StockLevel rows left behind so no reference to this
    // location survives its deletion (listByVariant populates locationId).
    await this.stockLevelModel.deleteMany({ tenantId: new Types.ObjectId(tenantId), locationId: doc._id }).exec();
    await this.model.deleteOne({ _id: id }).exec();
    return { deleted: true };
  }

  /**
   * Mirrors a stock change (already applied/validated against the cached total on
   * ProductVariant.quantityOnHand elsewhere) into the per-location ledger.
   * Best-effort: never lets the location balance drift below zero.
   *
   * Increments are unconditionally safe (upsert). Decrements use a `$gte` guard so two
   * concurrent decrements against the same location never race past zero — the old
   * `findOne` → `Math.max(0, ...)` → `updateOne` sequence had a TOCTOU window where both
   * reads could see the same stale quantity. If the guard can't be satisfied (not enough
   * recorded at this location, or no row yet), the location's quantity is clamped to zero
   * instead of throwing — same drift-tolerant posture as before, just race-free for the
   * common (sufficient stock) case.
   */
  async adjust(
    tenantId: string,
    variantId: string | Types.ObjectId,
    delta: number,
    locationId?: string | Types.ObjectId,
  ): Promise<void> {
    if (!delta) return;
    const tid = new Types.ObjectId(tenantId);
    const vid = new Types.ObjectId(variantId);
    const lid = locationId ? new Types.ObjectId(locationId) : (await this.getOrCreateDefault(tenantId))._id;

    if (delta > 0) {
      await this.stockLevelModel.updateOne(
        { tenantId: tid, variantId: vid, locationId: lid },
        { $inc: { quantity: delta } },
        { upsert: true },
      );
      return;
    }

    const updated = await this.stockLevelModel
      .findOneAndUpdate(
        { tenantId: tid, variantId: vid, locationId: lid, quantity: { $gte: -delta } },
        { $inc: { quantity: delta } },
      )
      .exec();
    if (!updated) {
      await this.stockLevelModel.updateOne(
        { tenantId: tid, variantId: vid, locationId: lid },
        { $set: { quantity: 0 } },
        { upsert: true },
      );
    }
  }

  /**
   * Atomically reserves up to `requestedQty` at one location — takes everything asked for
   * if available, otherwise takes whatever is left and returns that smaller amount, in a
   * single round-trip (no read-then-write race). Used by offline-sync (`OrdersService.syncBatch`)
   * to decide, per line, how much of an offline sale the location can actually cover before
   * the remainder is auto-converted into a backorder line.
   *
   * Implemented as a single `findOneAndUpdate` with an aggregation-pipeline update: the
   * document is clamped to `max(quantity - requestedQty, 0)`, and since `findOneAndUpdate`
   * without `{new: true}` returns the pre-image, that pre-image's `quantity` is exactly the
   * atomic snapshot needed to compute how much was actually taken — no other write can have
   * interleaved between reading and writing within a single MongoDB document operation.
   */
  async reserveUpToAvailable(
    tenantId: string,
    variantId: string | Types.ObjectId,
    locationId: string | Types.ObjectId,
    requestedQty: number,
  ): Promise<number> {
    if (requestedQty <= 0) return 0;
    const tid = new Types.ObjectId(tenantId);
    const vid = new Types.ObjectId(variantId);
    const lid = new Types.ObjectId(locationId);

    const before = await this.stockLevelModel
      .findOneAndUpdate(
        { tenantId: tid, variantId: vid, locationId: lid },
        [{ $set: { quantity: { $max: [{ $subtract: ['$quantity', requestedQty] }, 0] } } }],
        { updatePipeline: true },
      )
      .exec();
    if (!before) return 0;
    return Math.min(before.quantity, requestedQty);
  }

  /** Per-location breakdown for a variant (used by inventory screens). */
  async listByVariant(tenantId: string, variantId: string) {
    if (!Types.ObjectId.isValid(variantId)) throw new NotFoundException();
    const rows = await this.stockLevelModel
      .find({ tenantId: new Types.ObjectId(tenantId), variantId: new Types.ObjectId(variantId) })
      .populate<{ locationId: { _id: Types.ObjectId; name: string; isDefault: boolean } }>(
        'locationId',
        'name isDefault',
      )
      .lean()
      .exec();
    return rows
      .filter((r) => r.locationId != null)
      .map((r) => ({
        locationId: String(r.locationId._id),
        locationName: r.locationId.name,
        isDefault: r.locationId.isDefault,
        quantity: r.quantity,
      }));
  }

  async transfer(tenantId: string, dto: TransferStockDto) {
    if (dto.fromLocationId === dto.toLocationId) {
      throw new BadRequestException('Origem e destino não podem ser o mesmo local');
    }
    const tid = new Types.ObjectId(tenantId);
    const vid = new Types.ObjectId(dto.variantId);
    const fromId = new Types.ObjectId(dto.fromLocationId);
    const toId = new Types.ObjectId(dto.toLocationId);

    const [fromLocation, toLocation] = await Promise.all([
      this.model.findOne({ _id: fromId, tenantId: tid }).lean().exec(),
      this.model.findOne({ _id: toId, tenantId: tid }).lean().exec(),
    ]);
    if (!fromLocation || !toLocation) throw new NotFoundException('Local não encontrado');

    // Atomic guarded decrement instead of check-then-write: two concurrent transfers out of
    // the same location could otherwise both pass the pre-check against the same stale
    // `available` value and jointly overdraw it.
    const decremented = await this.stockLevelModel
      .findOneAndUpdate(
        { tenantId: tid, variantId: vid, locationId: fromId, quantity: { $gte: dto.quantity } },
        { $inc: { quantity: -dto.quantity } },
      )
      .exec();
    if (!decremented) {
      const fromRow = await this.stockLevelModel.findOne({ tenantId: tid, variantId: vid, locationId: fromId }).lean().exec();
      const available = fromRow?.quantity ?? 0;
      throw new BadRequestException(
        `Estoque insuficiente no local de origem: disponível ${available}, solicitado ${dto.quantity}`,
      );
    }

    await this.stockLevelModel.updateOne(
      { tenantId: tid, variantId: vid, locationId: toId },
      { $inc: { quantity: dto.quantity } },
      { upsert: true },
    );
    return { transferred: dto.quantity };
  }

  /**
   * Same move as `transfer()`, but for several variants at once — e.g. sending every size of
   * Legging Preta plus every size of Legging Branca to Banca Brás in a single action instead
   * of one call per SKU. Fails the whole batch up front if any item doesn't have enough stock
   * (no partial transfers from the caller's perspective, matching the same guarded-decrement
   * safety `transfer()` already has). If a later item still loses a decrement race against a
   * concurrent transfer despite passing the pre-check (rare — same variant, same instant),
   * everything already moved in this batch is rolled back rather than left half-done — there's
   * no multi-document transaction in this codebase to fall back on, so the rollback is explicit.
   */
  async transferBatch(tenantId: string, dto: TransferBatchStockDto) {
    if (dto.fromLocationId === dto.toLocationId) {
      throw new BadRequestException('Origem e destino não podem ser o mesmo local');
    }
    const tid = new Types.ObjectId(tenantId);
    const fromId = new Types.ObjectId(dto.fromLocationId);
    const toId = new Types.ObjectId(dto.toLocationId);

    const [fromLocation, toLocation] = await Promise.all([
      this.model.findOne({ _id: fromId, tenantId: tid }).lean().exec(),
      this.model.findOne({ _id: toId, tenantId: tid }).lean().exec(),
    ]);
    if (!fromLocation || !toLocation) throw new NotFoundException('Local não encontrado');

    const conflicts: Array<{ variantId: string; needed: number; available: number }> = [];
    for (const item of dto.items) {
      const row = await this.stockLevelModel
        .findOne({ tenantId: tid, variantId: new Types.ObjectId(item.variantId), locationId: fromId })
        .lean()
        .exec();
      const available = row?.quantity ?? 0;
      if (available < item.quantity) {
        conflicts.push({ variantId: item.variantId, needed: item.quantity, available });
      }
    }
    if (conflicts.length) {
      throw new BadRequestException({
        message: 'Estoque insuficiente no local de origem para um ou mais itens da transferência',
        conflicts,
      });
    }

    const committed: Array<{ variantId: Types.ObjectId; quantity: number }> = [];
    try {
      for (const item of dto.items) {
        const vid = new Types.ObjectId(item.variantId);
        const decremented = await this.stockLevelModel
          .findOneAndUpdate(
            { tenantId: tid, variantId: vid, locationId: fromId, quantity: { $gte: item.quantity } },
            { $inc: { quantity: -item.quantity } },
          )
          .exec();
        if (!decremented) {
          throw new BadRequestException(
            `Estoque insuficiente no local de origem para ${item.variantId} (alterado por outra transferência simultânea)`,
          );
        }
        await this.stockLevelModel.updateOne(
          { tenantId: tid, variantId: vid, locationId: toId },
          { $inc: { quantity: item.quantity } },
          { upsert: true },
        );
        committed.push({ variantId: vid, quantity: item.quantity });
      }
    } catch (e) {
      for (const c of committed) {
        await this.stockLevelModel.updateOne(
          { tenantId: tid, variantId: c.variantId, locationId: fromId },
          { $inc: { quantity: c.quantity } },
          { upsert: true },
        );
        await this.stockLevelModel.updateOne(
          { tenantId: tid, variantId: c.variantId, locationId: toId },
          { $inc: { quantity: -c.quantity } },
        );
      }
      throw e;
    }

    return { transferred: dto.items.length, items: dto.items };
  }

  /** Allocate stock from the tenant's central/default pool into a specific location —
   *  sugar over `transfer()` so callers don't need to know the default location's id. */
  async allocate(tenantId: string, dto: AllocateStockDto) {
    const fromLocationId = String((await this.getOrCreateDefault(tenantId))._id);
    return this.transfer(tenantId, {
      variantId: dto.variantId,
      fromLocationId,
      toLocationId: dto.toLocationId,
      quantity: dto.quantity,
    });
  }

  /**
   * One-time repair for the gap where initial stock intake (`ProductVariant.quantityOnHand`)
   * was never mirrored into `StockLevel` for any location — until a variant is allocated at
   * least once, the PDV (online or offline) sees it as having zero stock everywhere, even
   * though `quantityOnHand` says otherwise. Seeds `targetLocationId` with each such variant's
   * current `quantityOnHand`. Only touches variants with NO existing `StockLevel` row at any
   * location, so re-running this after real transfers/sales have happened is a no-op for them.
   */
  async backfillFromOnHand(tenantId: string, targetLocationId: string) {
    if (!Types.ObjectId.isValid(targetLocationId)) throw new NotFoundException();
    const tid = new Types.ObjectId(tenantId);
    const lid = new Types.ObjectId(targetLocationId);
    const location = await this.model.findOne({ _id: lid, tenantId: tid }).lean().exec();
    if (!location) throw new NotFoundException('Local não encontrado');

    const alreadyTracked = await this.stockLevelModel.distinct('variantId', { tenantId: tid }).exec();
    const variants = await this.variantModel
      .find({ tenantId: tid, quantityOnHand: { $gt: 0 }, _id: { $nin: alreadyTracked } })
      .select('_id quantityOnHand')
      .lean()
      .exec();
    if (!variants.length) return { seeded: 0 };

    await this.stockLevelModel.insertMany(
      variants.map((v) => ({
        tenantId: tid,
        variantId: v._id,
        locationId: lid,
        quantity: v.quantityOnHand,
      })),
    );
    return { seeded: variants.length };
  }

  /** Everything a location has allocated (quantity > 0), with product/SKU labels —
   *  used by the admin "estoque alocado" view and, later, the PDV offline catalog snapshot. */
  async stockByLocation(tenantId: string, locationId: string, page: number, limit: number) {
    if (!Types.ObjectId.isValid(locationId)) throw new NotFoundException();
    const tid = new Types.ObjectId(tenantId);
    const lid = new Types.ObjectId(locationId);
    const location = await this.model.findOne({ _id: lid, tenantId: tid }).lean().exec();
    if (!location) throw new NotFoundException('Local não encontrado');

    const query = { tenantId: tid, locationId: lid, quantity: { $gt: 0 } };
    const [rows, total] = await Promise.all([
      this.stockLevelModel
        .find(query)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate<{
          variantId: {
            _id: Types.ObjectId;
            sku: string;
            color?: string;
            size?: string;
            productId: { name: string } | null;
          } | null;
        }>({ path: 'variantId', select: 'sku color size productId', populate: { path: 'productId', select: 'name' } })
        .lean()
        .exec(),
      this.stockLevelModel.countDocuments(query).exec(),
    ]);

    const items = rows
      .filter((r) => r.variantId != null)
      .map((r) => {
        const productName = r.variantId!.productId?.name ?? '';
        const color = r.variantId!.color;
        const size = r.variantId!.size;
        const variantLabel = [color, size].filter(Boolean).join(' — ');
        return {
          variantId: String(r.variantId!._id),
          sku: r.variantId!.sku,
          productName,
          color,
          size,
          /** "Produto — Cor — Tamanho" pronto pra exibir — a lista tinha várias linhas do
           *  mesmo produto (uma por variante) distinguíveis só pelo SKU cru. */
          displayName: variantLabel ? `${productName} — ${variantLabel}` : productName,
          quantity: r.quantity,
        };
      });
    return { items, total, page, limit };
  }

  /**
   * "Onde está cada peça" numa única grade: cada variante é uma linha, cada local é uma
   * coluna. Antes só dava pra ver um local por vez — pra saber se uma peça também estava em
   * outro local era preciso trocar o filtro e comparar de cabeça.
   */
  async stockMatrix(tenantId: string) {
    const tid = new Types.ObjectId(tenantId);
    const [locations, rows] = await Promise.all([
      this.model.find({ tenantId: tid }).sort({ isDefault: -1, name: 1 }).lean().exec(),
      this.stockLevelModel
        .find({ tenantId: tid, quantity: { $gt: 0 } })
        .populate<{
          variantId: {
            _id: Types.ObjectId;
            sku: string;
            color?: string;
            size?: string;
            productId: { name: string } | null;
          } | null;
        }>({ path: 'variantId', select: 'sku color size productId', populate: { path: 'productId', select: 'name' } })
        .lean()
        .exec(),
    ]);

    const byVariant = new Map<
      string,
      {
        variantId: string;
        sku: string;
        productName: string;
        color?: string;
        size?: string;
        displayName: string;
        byLocation: Record<string, number>;
        total: number;
      }
    >();

    for (const r of rows) {
      if (!r.variantId) continue;
      const vid = String(r.variantId._id);
      let entry = byVariant.get(vid);
      if (!entry) {
        const productName = r.variantId.productId?.name ?? '';
        const color = r.variantId.color;
        const size = r.variantId.size;
        const variantLabel = [color, size].filter(Boolean).join(' — ');
        entry = {
          variantId: vid,
          sku: r.variantId.sku,
          productName,
          color,
          size,
          displayName: variantLabel ? `${productName} — ${variantLabel}` : productName,
          byLocation: {},
          total: 0,
        };
        byVariant.set(vid, entry);
      }
      entry.byLocation[String(r.locationId)] = r.quantity;
      entry.total += r.quantity;
    }

    const items = [...byVariant.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));

    return {
      locations: locations.map((l) => ({ _id: String(l._id), name: l.name, isDefault: !!l.isDefault })),
      items,
    };
  }
}
