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
import type { CreateLocationDto } from './dto/create-location.dto';
import type { UpdateLocationDto } from './dto/update-location.dto';
import type { TransferStockDto } from './dto/transfer-stock.dto';

const DEFAULT_LOCATION_NAME = 'Loja Principal';

@Injectable()
export class LocationsService {
  constructor(
    @InjectModel(Location.name) private readonly model: Model<Location>,
    @InjectModel(StockLevel.name) private readonly stockLevelModel: Model<StockLevel>,
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
    try {
      return await this.model.create({
        tenantId: new Types.ObjectId(tenantId),
        name: dto.name.trim(),
        address: dto.address?.trim(),
        isDefault: false,
        active: true,
      });
    } catch (e: any) {
      if (e?.code === 11000) {
        throw new ConflictException('Já existe um local com esse nome');
      }
      throw e;
    }
  }

  findAll(tenantId: string) {
    return this.model
      .find({ tenantId: new Types.ObjectId(tenantId) })
      .sort({ isDefault: -1, name: 1 })
      .lean()
      .exec();
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
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.address !== undefined) patch.address = dto.address?.trim();
    if (dto.active !== undefined) patch.active = dto.active;
    const doc = await this.model
      .findOneAndUpdate({ _id: id, tenantId: new Types.ObjectId(tenantId) }, patch, { new: true })
      .exec();
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

    const row = await this.stockLevelModel.findOne({ tenantId: tid, variantId: vid, locationId: lid }).exec();
    const next = Math.max(0, (row?.quantity ?? 0) + delta);
    await this.stockLevelModel.updateOne(
      { tenantId: tid, variantId: vid, locationId: lid },
      { $set: { quantity: next } },
      { upsert: true },
    );
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

    const fromRow = await this.stockLevelModel.findOne({ tenantId: tid, variantId: vid, locationId: fromId }).exec();
    const available = fromRow?.quantity ?? 0;
    if (dto.quantity > available) {
      throw new BadRequestException(
        `Estoque insuficiente no local de origem: disponível ${available}, solicitado ${dto.quantity}`,
      );
    }

    await this.stockLevelModel.updateOne(
      { tenantId: tid, variantId: vid, locationId: fromId },
      { $inc: { quantity: -dto.quantity } },
    );
    await this.stockLevelModel.updateOne(
      { tenantId: tid, variantId: vid, locationId: toId },
      { $inc: { quantity: dto.quantity } },
      { upsert: true },
    );
    return { transferred: dto.quantity };
  }
}
