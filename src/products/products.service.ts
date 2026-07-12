import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Model, Types } from 'mongoose';
import type { StaffImportResponse } from '../common/dto/staff-import.response';
import { parseBooleanLoose } from '../common/excel/cell-coerce';
import { ExcelSpreadsheetService } from '../common/excel/excel-spreadsheet.service';
import { skipFromPage } from '../common/dto/pagination-query.dto';
import type { CreateProductDto } from './dto/create-product.dto';
import type { ProductVariantUpsertDto } from './dto/product-variant-upsert.dto';
import type { CreateVariantDto } from './dto/create-variant.dto';
import type { StockMovementDto } from './dto/stock-movement.dto';
import type { ProductsBulkPatchDto } from './dto/products-bulk-patch.dto';
import type { UpdateProductDto } from './dto/update-product.dto';
import type { UpdateVariantDto } from './dto/update-variant.dto';
import { Product } from './schemas/product.schema';
import { ProductVariant } from './schemas/product-variant.schema';
import type { StockReason } from './schemas/stock-ledger.schema';
import { StockLedger } from './schemas/stock-ledger.schema';
import {
  PRODUCT_EXPORT_COLUMNS,
  productImportHeaderAliases,
} from './product-excel.constants';
import { LocationsService } from '../locations/locations.service';
import { buildSearchFilter, escapeRegex } from '../common/utils/text-search.util';

function slugifyFromName(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return s || 'produto';
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name) private readonly productModel: Model<Product>,
    @InjectModel(ProductVariant.name)
    private readonly variantModel: Model<ProductVariant>,
    @InjectModel(StockLedger.name)
    private readonly ledgerModel: Model<StockLedger>,
    private readonly excel: ExcelSpreadsheetService,
    private readonly eventEmitter: EventEmitter2,
    private readonly locations: LocationsService,
  ) {}

  private resolveVariantRetail(it: ProductVariantUpsertDto): number {
    const raw = it.priceRetail ?? it.price;
    if (raw === undefined || raw === null || !Number.isFinite(Number(raw)) || Number(raw) < 0) {
      throw new UnprocessableEntityException({
        message: 'Cada variante precisa de price ou priceRetail ≥ 0',
      });
    }
    return Number(raw);
  }

  /**
   * For a "ready_made" product (comprado pronto de fornecedor), the sale price is never
   * typed directly — it's always derived from cost + markup, so the two can't drift apart.
   * Falls back to the existing document's values on a partial PATCH (e.g. only markupPercent
   * changed). Returns `{}` for a 'manufactured' product — no cost/supplier requirement there,
   * that costing lives in the production module instead.
   */
  private resolveReadyMadePricing(
    dto: {
      sourceType?: 'manufactured' | 'ready_made';
      costPrice?: number;
      markupPercent?: number;
      supplierId?: string;
    },
    existing?: {
      sourceType?: string;
      costPrice?: number;
      markupPercent?: number;
      supplierId?: Types.ObjectId;
    } | null,
  ): { priceRetail?: number } {
    const sourceType = dto.sourceType ?? existing?.sourceType ?? 'manufactured';
    if (sourceType !== 'ready_made') return {};

    const costPrice = dto.costPrice ?? existing?.costPrice;
    const markupPercent = dto.markupPercent ?? existing?.markupPercent;
    const supplierId = dto.supplierId ?? (existing?.supplierId ? String(existing.supplierId) : undefined);

    if (costPrice === undefined || costPrice === null || !Number.isFinite(Number(costPrice)) || Number(costPrice) < 0) {
      throw new UnprocessableEntityException({
        message: 'Item pronto precisa de um preço de custo ≥ 0',
      });
    }
    if (
      markupPercent === undefined ||
      markupPercent === null ||
      !Number.isFinite(Number(markupPercent)) ||
      Number(markupPercent) < 0
    ) {
      throw new UnprocessableEntityException({
        message: 'Item pronto precisa de uma margem (%) ≥ 0',
      });
    }
    if (!supplierId || !Types.ObjectId.isValid(supplierId)) {
      throw new UnprocessableEntityException({
        message: 'Item pronto precisa de um fornecedor',
      });
    }

    const priceRetail = Math.round(Number(costPrice) * (1 + Number(markupPercent) / 100) * 100) / 100;
    return { priceRetail };
  }

  /** API: espelha quantityOnHand como quantityInStock + preços varejo/atacado. */
  private mapVariantForApi(
    v: Record<string, unknown>,
    product?: Record<string, unknown>,
  ): Record<string, unknown> {
    const o: Record<string, unknown> = { ...v };
    if (o._id) o._id = String(o._id);
    if (o.productId) o.productId = String(o.productId);
    const qoh =
      typeof o.quantityOnHand === 'number' && !Number.isNaN(o.quantityOnHand)
        ? o.quantityOnHand
        : 0;
    o.quantityOnHand = qoh;
    o.quantityInStock = qoh;

    const retail = Number(o.price ?? 0);
    o.price = retail;
    o.priceRetail = retail;

    const pWholesale = product?.priceWholesale;
    const vWholesale = o.priceWholesale;
    let wholesale: number;
    if (vWholesale !== undefined && vWholesale !== null && vWholesale !== '') {
      wholesale = Number(vWholesale);
    } else if (pWholesale !== undefined && pWholesale !== null && pWholesale !== '') {
      wholesale = Number(pWholesale);
    } else {
      wholesale = retail;
    }
    o.priceWholesale = wholesale;

    const minP = product?.minWholesaleQty;
    const minV = o.minWholesaleQty;
    const minW =
      typeof minV === 'number' && !Number.isNaN(minV)
        ? minV
        : typeof minP === 'number' && !Number.isNaN(minP)
          ? minP
          : 6;
    o.minWholesaleQty = minW;

    return o;
  }

  /**
   * Effective retail/wholesale pricing for a variant, applying the same
   * variant-overrides-product fallback used to display pricing in the catalog.
   * Used to price public checkout lines server-side (never trust a client-sent unit price).
   */
  async getWholesalePricing(
    tenantId: string,
    variantId: string,
  ): Promise<{ priceRetail: number; priceWholesale: number; minWholesaleQty: number } | null> {
    const v = await this.variantModel
      .findOne({ _id: variantId, tenantId: new Types.ObjectId(tenantId) })
      .lean()
      .exec();
    if (!v) return null;
    const product = await this.productModel
      .findOne({ _id: v.productId, tenantId: new Types.ObjectId(tenantId) })
      .lean()
      .exec();

    const priceRetail = Number(v.price ?? 0);
    const vWholesale = v.priceWholesale;
    const pWholesale = product?.priceWholesale;
    const priceWholesale =
      vWholesale !== undefined && vWholesale !== null
        ? Number(vWholesale)
        : pWholesale !== undefined && pWholesale !== null
          ? Number(pWholesale)
          : priceRetail;

    const minV = v.minWholesaleQty;
    const minP = product?.minWholesaleQty;
    const minWholesaleQty =
      typeof minV === 'number' && !Number.isNaN(minV)
        ? minV
        : typeof minP === 'number' && !Number.isNaN(minP)
          ? minP
          : 6;

    return { priceRetail, priceWholesale, minWholesaleQty };
  }

  /**
   * Same pricing rule as `getWholesalePricing`, batched for a cart of variants — two
   * queries total instead of two per line (avoids N+1 when pricing checkout/order lines).
   */
  async getWholesalePricingBatch(
    tenantId: string,
    variantIds: string[],
  ): Promise<Map<string, { priceRetail: number; priceWholesale: number; minWholesaleQty: number }>> {
    const out = new Map<string, { priceRetail: number; priceWholesale: number; minWholesaleQty: number }>();
    const ids = [...new Set(variantIds)].filter((id) => Types.ObjectId.isValid(id));
    if (!ids.length) return out;
    const tid = new Types.ObjectId(tenantId);
    const variants = await this.variantModel
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) }, tenantId: tid })
      .lean()
      .exec();
    const productIds = [...new Set(variants.map((v) => String(v.productId)))];
    const products = await this.productModel
      .find({ _id: { $in: productIds.map((id) => new Types.ObjectId(id)) }, tenantId: tid })
      .lean()
      .exec();
    const productById = new Map(products.map((p) => [String(p._id), p]));

    for (const v of variants) {
      const product = productById.get(String(v.productId));
      const priceRetail = Number(v.price ?? 0);
      const vWholesale = v.priceWholesale;
      const pWholesale = product?.priceWholesale;
      const priceWholesale =
        vWholesale !== undefined && vWholesale !== null
          ? Number(vWholesale)
          : pWholesale !== undefined && pWholesale !== null
            ? Number(pWholesale)
            : priceRetail;
      const minV = v.minWholesaleQty;
      const minP = product?.minWholesaleQty;
      const minWholesaleQty =
        typeof minV === 'number' && !Number.isNaN(minV)
          ? minV
          : typeof minP === 'number' && !Number.isNaN(minP)
            ? minP
            : 6;
      out.set(String(v._id), { priceRetail, priceWholesale, minWholesaleQty });
    }
    return out;
  }

  private enrichProductPricing(
    p: Record<string, unknown>,
    variantApis: Record<string, unknown>[],
  ): Record<string, unknown> {
    const first = variantApis[0];
    const vRetail = first ? Number(first.priceRetail ?? first.price ?? 0) : 0;
    const priceRetail =
      p.priceRetail !== undefined && p.priceRetail !== null ? Number(p.priceRetail) : vRetail;
    let priceWholesale = priceRetail;
    const pw = p.priceWholesale;
    if (pw !== undefined && pw !== null && pw !== '') {
      priceWholesale = Number(pw);
    }
    const minWholesaleQty =
      typeof p.minWholesaleQty === 'number' && !Number.isNaN(p.minWholesaleQty)
        ? Number(p.minWholesaleQty)
        : 6;
    const sku =
      typeof first?.sku === 'string'
        ? first.sku
        : first?.sku !== undefined
          ? String(first.sku)
          : '';
    const images =
      Array.isArray(p.images) && p.images.length > 0
        ? p.images
        : Array.isArray(first?.images)
          ? first.images
          : [];

    // Derive primaryImageUrl: product-level field takes priority; fall back to first variant image
    const primaryImageUrl =
      (p.primaryImageUrl as string | undefined) ??
      (Array.isArray(first?.images) && (first.images as Array<{ url?: string } | string>)[0]
        ? typeof (first.images as Array<{ url?: string } | string>)[0] === 'string'
          ? ((first.images as string[])[0] as string)
          : ((first.images as Array<{ url: string }>)[0]?.url ?? '')
        : undefined);

    return {
      ...p,
      _id: p._id ? String(p._id) : p._id,
      sku,
      images,
      primaryImageUrl: primaryImageUrl ?? null,
      priceRetail,
      priceWholesale,
      minWholesaleQty,
      compareAtPrice: p.compareAtPrice,
    };
  }

  private async attachVariantsToProducts(
    tenantId: string,
    products: Array<Record<string, unknown>>,
  ): Promise<Array<Record<string, unknown>>> {
    if (!products.length) return products;
    const ids = products.map((p) => new Types.ObjectId(String(p._id)));
    const all = await this.variantModel
      .find({ tenantId: new Types.ObjectId(tenantId), productId: { $in: ids } })
      .sort({ sku: 1 })
      .lean()
      .exec();
    const byPid = new Map<string, Record<string, unknown>[]>();
    for (const v of all) {
      const pid = String(v.productId);
      const list = byPid.get(pid) ?? [];
      const prod = products.find((x) => String(x._id) === pid);
      list.push(
        this.mapVariantForApi(v as unknown as Record<string, unknown>, prod),
      );
      byPid.set(pid, list);
    }
    return products.map((p) => {
      const variants = byPid.get(String(p._id)) ?? [];
      return this.enrichProductPricing(
        { ...p, variants },
        variants,
      );
    });
  }

  private resolveVariantQty(dto: ProductVariantUpsertDto): number {
    const a = dto.quantityInStock;
    const b = dto.quantityOnHand;
    const n =
      a !== undefined && a !== null
        ? Number(a)
        : b !== undefined && b !== null
          ? Number(b)
          : 0;
    if (!Number.isFinite(n) || n < 0) {
      throw new UnprocessableEntityException({
        message: 'Cada variante precisa de quantityInStock / quantityOnHand ≥ 0',
      });
    }
    return Math.floor(n);
  }

  /** SKU único global (case-insensitive); permite o próprio documento em updates. */
  private async assertSkuFreeForProduct(
    tenantId: string,
    sku: string,
    excludeVariantId?: Types.ObjectId,
  ) {
    const re = new RegExp(`^${escapeRegex(sku.trim())}$`, 'i');
    const found = await this.variantModel.findOne({ tenantId: new Types.ObjectId(tenantId), sku: { $regex: re } }).lean().exec();
    if (!found) return;
    if (excludeVariantId && String(found._id) === String(excludeVariantId)) return;
    throw new ConflictException({
      message: `SKU já em uso: ${sku.trim()}`,
    });
  }

  private async replaceProductVariants(
    tenantId: string,
    productId: Types.ObjectId,
    items: ProductVariantUpsertDto[],
  ): Promise<void> {
    const productDoc = (await this.productModel
      .findOne({ _id: productId, tenantId: new Types.ObjectId(tenantId) })
      .lean()
      .exec()) as Record<string, unknown> | null;
    if (!productDoc) {
      throw new NotFoundException();
    }
    if (!items.length) {
      throw new UnprocessableEntityException({
        message: 'variants não pode ser um array vazio',
      });
    }
    const seen = new Set<string>();
    for (const it of items) {
      const key = it.sku.trim().toLowerCase();
      if (seen.has(key)) {
        throw new UnprocessableEntityException({
          message: `SKU duplicado no produto: ${it.sku.trim()}`,
        });
      }
      seen.add(key);
    }

    const existing = await this.variantModel.find({ productId, tenantId: new Types.ObjectId(tenantId) }).lean().exec();
    const existingById = new Map(
      existing.map((v) => [String(v._id), v] as const),
    );

    const keptIds: Types.ObjectId[] = [];

    for (const it of items) {
      const sku = it.sku.trim();
      if (!sku) {
        throw new UnprocessableEntityException({
          message: 'Cada variante precisa de sku',
        });
      }
      const qty = this.resolveVariantQty(it);
      const retail = this.resolveVariantRetail(it);

      let priceWholesale: number | null = null;
      if (it.priceWholesale === undefined) {
        if (
          productDoc.priceWholesale !== undefined &&
          productDoc.priceWholesale !== null &&
          productDoc.priceWholesale !== ''
        ) {
          priceWholesale = Number(productDoc.priceWholesale);
        }
      } else if (it.priceWholesale === null) {
        priceWholesale = null;
      } else {
        priceWholesale = Number(it.priceWholesale);
      }

      const payload: Record<string, unknown> = {
        sku,
        color: it.color?.trim() || undefined,
        size: it.size?.trim() || undefined,
        price: retail,
        priceWholesale,
        compareAtPrice: it.compareAtPrice,
        barcode: it.barcode?.trim() || undefined,
        quantityOnHand: qty,
        images: it.images ?? [],
      };
      if (it.minWholesaleQty !== undefined) {
        payload.minWholesaleQty = Math.floor(Number(it.minWholesaleQty));
      }
      if (it.acceptsBackorder !== undefined) {
        payload.acceptsBackorder = it.acceptsBackorder;
      }
      if (it.backorderMinQty !== undefined) {
        payload.backorderMinQty = Math.max(1, Math.floor(Number(it.backorderMinQty)));
      }

      if (it._id && Types.ObjectId.isValid(it._id)) {
        const oid = new Types.ObjectId(it._id);
        const prev = existingById.get(String(oid));
        if (prev && String(prev.productId) === String(productId)) {
          await this.assertSkuFreeForProduct(tenantId, sku, oid);
          await this.variantModel.updateOne({ _id: oid, tenantId: new Types.ObjectId(tenantId) }, { $set: payload }).exec();
          keptIds.push(oid);
        } else {
          await this.assertSkuFreeForProduct(tenantId, sku);
          try {
            const doc = await this.variantModel.create({
              tenantId: new Types.ObjectId(tenantId),
              productId,
              ...payload,
              reorderPoint: 0,
            });
            if (qty !== 0) {
              await this.ledgerModel.create({
                tenantId: new Types.ObjectId(tenantId),
                variantId: doc._id as Types.ObjectId,
                delta: qty,
                reason: 'initial',
                note: 'Initial on-hand at variant upsert',
              });
            }
            keptIds.push(doc._id as Types.ObjectId);
          } catch (e: unknown) {
            if (
              e &&
              typeof e === 'object' &&
              'code' in e &&
              (e as { code: number }).code === 11000
            ) {
              throw new ConflictException({ message: `SKU já em uso: ${sku}` });
            }
            throw e;
          }
        }
      } else {
        await this.assertSkuFreeForProduct(tenantId, sku);
        try {
          const doc = await this.variantModel.create({
            tenantId: new Types.ObjectId(tenantId),
            productId,
            ...payload,
            reorderPoint: 0,
          });
          if (qty !== 0) {
            await this.ledgerModel.create({
              tenantId: new Types.ObjectId(tenantId),
              variantId: doc._id as Types.ObjectId,
              delta: qty,
              reason: 'initial',
              note: 'Initial on-hand at variant upsert',
            });
          }
          keptIds.push(doc._id as Types.ObjectId);
        } catch (e: unknown) {
          if (
            e &&
            typeof e === 'object' &&
            'code' in e &&
            (e as { code: number }).code === 11000
          ) {
            throw new ConflictException({ message: `SKU já em uso: ${sku}` });
          }
          throw e;
        }
      }
    }

    const keepSet = new Set(keptIds.map((id) => String(id)));
    for (const v of existing) {
      if (!keepSet.has(String(v._id))) {
        await this.ledgerModel.deleteMany({ tenantId: new Types.ObjectId(tenantId), variantId: v._id }).exec();
        await this.variantModel.deleteOne({ tenantId: new Types.ObjectId(tenantId), _id: v._id }).exec();
      }
    }
  }

  private async rollbackNewProduct(tenantId: string, pid: Types.ObjectId) {
    const vs = await this.variantModel.find({ tenantId: new Types.ObjectId(tenantId), productId: pid }).select('_id').lean().exec();
    for (const v of vs) {
      await this.ledgerModel.deleteMany({ tenantId: new Types.ObjectId(tenantId), variantId: v._id }).exec();
    }
    await this.variantModel.deleteMany({ tenantId: new Types.ObjectId(tenantId), productId: pid }).exec();
    await this.productModel.deleteOne({ tenantId: new Types.ObjectId(tenantId), _id: pid }).exec();
  }

  async createProduct(tenantId: string, dto: CreateProductDto) {
    const readyMade = this.resolveReadyMadePricing(dto);
    const computedPriceRetail = readyMade.priceRetail;

    const doc = await this.productModel.create({
      tenantId: new Types.ObjectId(tenantId),
      name: dto.name,
      slug: dto.slug.toLowerCase(),
      description: dto.description,
      category: dto.category,
      active: dto.active ?? true,
      priceRetail: computedPriceRetail ?? dto.priceRetail,
      priceWholesale: dto.priceWholesale,
      minWholesaleQty: dto.minWholesaleQty ?? 6,
      compareAtPrice: dto.compareAtPrice,
      primaryImageUrl: dto.primaryImageUrl,
      images: dto.images ?? [],
      barcode: dto.barcode,
      weightGrams: dto.weightGrams,
      sourceType: dto.sourceType ?? 'manufactured',
      costPrice: dto.costPrice,
      markupPercent: dto.markupPercent,
      supplierId: dto.supplierId ? new Types.ObjectId(dto.supplierId) : undefined,
    });
    const pid = doc._id as Types.ObjectId;

    try {
      if (dto.variants !== undefined) {
        if (!dto.variants.length) {
          throw new UnprocessableEntityException({
            message: 'variants não pode ser um array vazio',
          });
        }
        // Item pronto: o preço calculado (custo + margem) vira o padrão de cada variante que
        // não tiver preço próprio informado — mas uma variante ainda pode sobrescrever.
        const variants =
          computedPriceRetail !== undefined
            ? dto.variants.map((v) =>
                v.priceRetail === undefined && v.price === undefined
                  ? { ...v, priceRetail: computedPriceRetail }
                  : v,
              )
            : dto.variants;
        await this.replaceProductVariants(tenantId, pid, variants);
      } else if (dto.sku?.trim()) {
        const qty = Math.floor(
          Number(
            dto.quantityInStock !== undefined && dto.quantityInStock !== null
              ? dto.quantityInStock
              : 0,
          ),
        );
        const retail =
          computedPriceRetail !== undefined
            ? computedPriceRetail
            : dto.priceRetail !== undefined && dto.priceRetail !== null
              ? Number(dto.priceRetail)
              : dto.price !== undefined && dto.price !== null
                ? Number(dto.price)
                : 0;
        if (retail < 0 || qty < 0) {
          throw new UnprocessableEntityException({
            message: 'price e quantityInStock devem ser ≥ 0',
          });
        }
        let vWholesale: number | null = null;
        if (dto.priceWholesale !== undefined) {
          vWholesale = dto.priceWholesale === null ? null : Number(dto.priceWholesale);
        } else if (
          doc.priceWholesale !== undefined &&
          doc.priceWholesale !== null
        ) {
          vWholesale = Number(doc.priceWholesale);
        }
        try {
          const vdoc = await this.variantModel.create({
            tenantId: new Types.ObjectId(tenantId),
            productId: pid,
            sku: dto.sku.trim(),
            price: retail,
            priceWholesale: vWholesale,
            minWholesaleQty: dto.minWholesaleQty,
            quantityOnHand: qty,
            reorderPoint: 0,
            images: [],
          });
          if (qty !== 0) {
            await this.ledgerModel.create({
              tenantId: new Types.ObjectId(tenantId),
              variantId: vdoc._id as Types.ObjectId,
              delta: qty,
              reason: 'initial',
              note: 'Initial on-hand at product create (single variant)',
            });
          }
        } catch (e: unknown) {
          if (
            e &&
            typeof e === 'object' &&
            'code' in e &&
            (e as { code: number }).code === 11000
          ) {
            throw new ConflictException({ message: `SKU já em uso: ${dto.sku.trim()}` });
          }
          throw e;
        }
      }
    } catch (e) {
      await this.rollbackNewProduct(tenantId, pid);
      throw e;
    }

    return this.getProduct(tenantId, String(pid));
  }

  async listProducts(tenantId: string, page: number, limit: number, search?: string) {
    const skip = skipFromPage(page, limit);
    const q = buildSearchFilter(tenantId, search, ['name', 'slug']);
    const [rawItems, total] = await Promise.all([
      this.productModel
        .find(q)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate<{ supplierId: { _id: Types.ObjectId; name: string } | null }>('supplierId', 'name')
        .lean(),
      this.productModel.countDocuments(q).exec(),
    ]);
    const flattened = rawItems.map((p) => {
      const o = p as unknown as Record<string, unknown>;
      if (o.supplierId && typeof o.supplierId === 'object') {
        const sup = o.supplierId as { _id: Types.ObjectId; name: string };
        o.supplierName = sup.name;
        o.supplierId = String(sup._id);
      }
      return o;
    });
    const items = await this.attachVariantsToProducts(tenantId, flattened);
    return { items, total, page, limit };
  }

  private productListFilter(tenantId: string, search?: string) {
    return buildSearchFilter(tenantId, search, ['name', 'slug']);
  }

  async findAllProductsForExport(tenantId: string, search?: string) {
    const q = this.productListFilter(tenantId, search);
    return this.productModel.find(q).sort({ createdAt: -1 }).lean().exec();
  }

  serializeProductRow(doc: Record<string, unknown>): Record<string, unknown> {
    const o: Record<string, unknown> = { ...doc };
    if (o._id) o._id = String(o._id);
    if (typeof o.active === 'boolean') {
      o.active = o.active ? 'Sim' : 'Não';
    }
    if (o.createdAt instanceof Date) o.createdAt = o.createdAt.toISOString();
    if (o.updatedAt instanceof Date) o.updatedAt = o.updatedAt.toISOString();
    return o;
  }

  async exportProductsBuffer(
    tenantId: string,
    format: 'xlsx' | 'csv',
    search?: string,
  ): Promise<{ buffer: Buffer; filename: string; mime: string }> {
    const rawDocs = await this.findAllProductsForExport(tenantId, search);
    const docs = await this.attachVariantsToProducts(tenantId, rawDocs as unknown as Record<string, unknown>[]);
    const rows: Record<string, unknown>[] = [];
    
    for (const doc of docs) {
      const p = this.serializeProductRow(doc);
      const variants = doc.variants as Record<string, unknown>[];
      if (variants && variants.length > 0) {
        for (const v of variants) {
          rows.push({
            ...p,
            sku: v.sku,
            color: v.color,
            size: v.size,
            price: v.price,
            quantityInStock: v.quantityInStock,
          });
        }
      } else {
        rows.push(p);
      }
    }

    const buffer =
      format === 'csv'
        ? this.excel.buildCsvBuffer(PRODUCT_EXPORT_COLUMNS, rows)
        : await this.excel.buildXlsxBuffer(
            'Produtos',
            PRODUCT_EXPORT_COLUMNS,
            rows,
          );
    return {
      buffer,
      filename: `products.${format === 'csv' ? 'csv' : 'xlsx'}`,
      mime:
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  private parseProductRow(row: Record<string, unknown>): {
    id?: string;
    create?: CreateProductDto;
    patch: UpdateProductDto;
  } {
    const idRaw = row._id ?? row.id;
    const id =
      idRaw !== undefined && idRaw !== '' && String(idRaw).length === 24
        ? String(idRaw)
        : undefined;
    const name = String(row.name ?? '').trim();
    let slug = String(row.slug ?? '').trim().toLowerCase();
    const description =
      row.description !== undefined ? String(row.description).trim() : undefined;
    const category =
      row.category !== undefined ? String(row.category).trim() : undefined;
    const activeRaw = row.active;
    const active =
      activeRaw === undefined || activeRaw === ''
        ? undefined
        : parseBooleanLoose(activeRaw);

    const patch: UpdateProductDto = {};
    if (name) patch.name = name;
    if (slug) patch.slug = slug;
    if (description !== undefined) patch.description = description;
    if (category !== undefined) patch.category = category;
    if (active !== undefined) patch.active = active;

    if (id) {
      return { id, patch };
    }
    if (!name) throw new BadRequestException('name é obrigatório');
    if (!slug) slug = slugifyFromName(name);
    const create: CreateProductDto = {
      name,
      slug,
      description,
      category,
      active: active ?? true,
    };
    return { id, create, patch };
  }

  async importProductsFromJson(
    tenantId: string,
    items: Record<string, unknown>[],
    dryRun: boolean,
  ): Promise<StaffImportResponse> {
    return this.importProductRecords(tenantId, items, dryRun);
  }

  async importProductsFromXlsx(
    tenantId: string,
    buffer: Buffer,
    dryRun: boolean,
  ): Promise<StaffImportResponse> {
    const records = await this.excel.parseFirstSheetToRecords(
      buffer,
      productImportHeaderAliases(),
    );
    return this.importProductRecords(tenantId, records, dryRun);
  }

  private async importProductRecords(
    tenantId: string,
    items: Record<string, unknown>[],
    dryRun: boolean,
  ): Promise<StaffImportResponse> {
    const errors: { row: number; message: string }[] = [];
    let imported = 0;
    let updated = 0;
    const skipped = 0;

    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const item of items) {
       const key = item._id ? String(item._id) : String(item.name ?? '').trim().toLowerCase();
       if (!key) continue;
       const list = grouped.get(key) || [];
       list.push(item);
       grouped.set(key, list);
    }

    let groupIndex = 0;
    for (const [key, rows] of grouped.entries()) {
      groupIndex++;
      try {
        const mainRow = rows[0];
        const { id, create, patch } = this.parseProductRow(mainRow);
        
        const variants: ProductVariantUpsertDto[] = [];
        let vSeq = 0;
        for (const row of rows) {
          if (row.sku || row.color || row.size) {
            variants.push({
              clientKey: `import-${Date.now()}-${vSeq++}`,
              sku: String(row.sku ?? '').trim(),
              color: String(row.color ?? '').trim() || 'Único',
              size: String(row.size ?? '').trim() || 'Único',
              price: Number(row.price ?? mainRow.price ?? 0),
              quantityInStock: Number(row.quantityInStock ?? mainRow.quantityInStock ?? 0),
            } as any);
          }
        }

        if (variants.length > 0) {
          if (create) create.variants = variants;
          patch.variants = variants;
        }

        if (dryRun) {
          if (id && Types.ObjectId.isValid(id)) {
            const exists = await this.productModel.findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) }).lean().exec();
            if (!exists) {
              errors.push({
                row: groupIndex,
                message: `_id não encontrado: ${id}`,
              });
            }
          }
          continue;
        }

        if (id && Types.ObjectId.isValid(id)) {
          const exists = await this.productModel.findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) }).exec();
          if (!exists) {
            errors.push({ row: groupIndex, message: `_id não encontrado: ${id}` });
            continue;
          }
          if (Object.keys(patch).length === 0 && (!patch.variants || patch.variants.length === 0)) {
            continue;
          }
          await this.updateProduct(tenantId, id, patch);
          updated++;
        } else {
          if (!create) {
            errors.push({ row: groupIndex, message: 'Linha inválida' });
            continue;
          }
          await this.createProduct(tenantId, create);
          imported++;
        }
      } catch (e) {
        const msg =
          e instanceof BadRequestException
            ? String(e.message)
            : e instanceof Error
              ? e.message
              : 'Erro desconhecido';
        errors.push({ row: groupIndex, message: msg });
      }
    }

    if (dryRun) {
      return {
        imported: 0,
        updated: 0,
        skipped: 0,
        valid: grouped.size - errors.length,
        errors,
        message:
          errors.length === 0
            ? 'Validação concluída sem erros (dryRun).'
            : `Validação dryRun: ${errors.length} produto(s) com erro.`,
      };
    }

    return {
      imported,
      updated,
      skipped,
      errors,
      message:
        errors.length === 0
          ? 'Importação concluída.'
          : `Importação concluída com ${errors.length} erro(s).`,
    };
  }

  /**
   * Busca exata por código de barras — usada pelo scanner de câmera no PDV.
   * Tenta a variante primeiro (caso comum: cor/tamanho tem EAN próprio),
   * cai pro código de barras do produto se nenhuma variante bater.
   */
  async findByBarcode(tenantId: string, code: string): Promise<{ product: Record<string, unknown>; variantId?: string }> {
    const trimmed = code.trim();
    if (!trimmed) throw new NotFoundException('Código de barras vazio');
    const tid = new Types.ObjectId(tenantId);

    const variant = await this.variantModel.findOne({ tenantId: tid, barcode: trimmed }).lean().exec();
    if (variant) {
      const product = await this.getProduct(tenantId, String(variant.productId));
      return { product, variantId: String(variant._id) };
    }

    const product = await this.productModel.findOne({ tenantId: tid, barcode: trimmed }).lean().exec();
    if (product) {
      return { product: await this.getProduct(tenantId, String(product._id)) };
    }

    throw new NotFoundException(`Nenhum produto encontrado com o código ${trimmed}`);
  }

  async getProduct(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const p = await this.productModel
      .findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) })
      .populate<{ supplierId: { _id: Types.ObjectId; name: string } | null }>('supplierId', 'name')
      .lean()
      .exec();
    if (!p) throw new NotFoundException();
    const pObj = p as unknown as Record<string, unknown>;
    if (pObj.supplierId && typeof pObj.supplierId === 'object') {
      const sup = pObj.supplierId as { _id: Types.ObjectId; name: string };
      pObj.supplierName = sup.name;
      pObj.supplierId = String(sup._id);
    }
    const variantsRaw = await this.variantModel
      .find({ productId: new Types.ObjectId(id), tenantId: new Types.ObjectId(tenantId) })
      .sort({ sku: 1 })
      .lean();
    const variants = variantsRaw.map((v) =>
      this.mapVariantForApi(v as unknown as Record<string, unknown>, pObj),
    );
    return this.enrichProductPricing({ ...pObj, variants }, variants);
  }

  async updateProduct(tenantId: string, id: string, dto: UpdateProductDto) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const pid = new Types.ObjectId(id);

    const existing = await this.productModel
      .findOne({ _id: pid, tenantId: new Types.ObjectId(tenantId) })
      .lean()
      .exec();
    if (!existing) throw new NotFoundException();

    // Only recompute when the request touches a ready-made field, or the product already
    // is one (e.g. bumping stock/description shouldn't force cost+markup to be re-sent).
    const touchesReadyMade =
      dto.sourceType !== undefined ||
      dto.costPrice !== undefined ||
      dto.markupPercent !== undefined ||
      dto.supplierId !== undefined;
    const readyMade =
      touchesReadyMade || existing.sourceType === 'ready_made'
        ? this.resolveReadyMadePricing(dto, existing as unknown as Record<string, unknown>)
        : {};
    const computedPriceRetail = readyMade.priceRetail;

    if (dto.variants !== undefined) {
      if (!dto.variants.length) {
        throw new UnprocessableEntityException({
          message: 'variants não pode ser um array vazio',
        });
      }
      const variants =
        computedPriceRetail !== undefined
          ? dto.variants.map((v) =>
              v.priceRetail === undefined && v.price === undefined
                ? { ...v, priceRetail: computedPriceRetail }
                : v,
            )
          : dto.variants;
      await this.replaceProductVariants(tenantId, pid, variants);
    }

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.slug !== undefined) patch.slug = dto.slug.toLowerCase();
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.category !== undefined) patch.category = dto.category;
    if (dto.active !== undefined) patch.active = dto.active;
    if (dto.priceRetail !== undefined) patch.priceRetail = dto.priceRetail;
    if (dto.priceWholesale !== undefined) patch.priceWholesale = dto.priceWholesale;
    if (dto.minWholesaleQty !== undefined) patch.minWholesaleQty = dto.minWholesaleQty;
    if (dto.compareAtPrice !== undefined) patch.compareAtPrice = dto.compareAtPrice;
    if (dto.primaryImageUrl !== undefined) patch.primaryImageUrl = dto.primaryImageUrl;
    if (dto.images !== undefined) patch.images = dto.images;
    if (dto.barcode !== undefined) patch.barcode = dto.barcode;
    if (dto.weightGrams !== undefined) patch.weightGrams = dto.weightGrams;
    if (dto.sourceType !== undefined) patch.sourceType = dto.sourceType;
    if (dto.costPrice !== undefined) patch.costPrice = dto.costPrice;
    if (dto.markupPercent !== undefined) patch.markupPercent = dto.markupPercent;
    if (dto.supplierId !== undefined) {
      patch.supplierId = dto.supplierId ? new Types.ObjectId(dto.supplierId) : undefined;
    }
    // Authoritative: computed price always wins over any client-sent priceRetail for a
    // ready-made item, so the two can never drift apart.
    if (computedPriceRetail !== undefined) patch.priceRetail = computedPriceRetail;

    if (Object.keys(patch).length > 0) {
      const doc = await this.productModel
        .findOneAndUpdate({ _id: id, tenantId: new Types.ObjectId(tenantId) }, patch, { new: true })
        .lean()
        .exec();
      if (!doc) throw new NotFoundException();
    } else {
      const exists = await this.productModel.findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) }).lean().exec();
      if (!exists) throw new NotFoundException();
    }

    return this.getProduct(tenantId, id);
  }

  async removeProduct(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const pid = new Types.ObjectId(id);
    const variants = await this.variantModel.find({ productId: pid, tenantId: new Types.ObjectId(tenantId) }).exec();
    for (const v of variants) {
      await this.ledgerModel.deleteMany({ variantId: v._id, tenantId: new Types.ObjectId(tenantId) }).exec();
      await this.variantModel.deleteOne({ _id: v._id, tenantId: new Types.ObjectId(tenantId) }).exec();
    }
    const res = await this.productModel.findOneAndDelete({ _id: id, tenantId: new Types.ObjectId(tenantId) }).exec();
    if (!res) throw new NotFoundException();
    return { deleted: true };
  }

  async createVariant(tenantId: string, productId: string, dto: CreateVariantDto) {
    if (!Types.ObjectId.isValid(productId)) throw new NotFoundException();
    const p = await this.productModel.findOne({ _id: productId, tenantId: new Types.ObjectId(tenantId) }).exec();
    if (!p) throw new NotFoundException();
    const qty = dto.quantityOnHand ?? 0;
    const doc = await this.variantModel.create({
      tenantId: new Types.ObjectId(tenantId),
      productId: new Types.ObjectId(productId),
      sku: dto.sku.trim(),
      color: dto.color,
      size: dto.size,
      price: dto.price ?? 0,
      priceWholesale: dto.priceWholesale,
      minWholesaleQty: dto.minWholesaleQty,
      compareAtPrice: dto.compareAtPrice,
      barcode: dto.barcode,
      quantityOnHand: qty,
      reorderPoint: dto.reorderPoint ?? 0,
      acceptsBackorder: dto.acceptsBackorder ?? false,
      backorderMinQty: dto.backorderMinQty ?? 1,
      images: dto.images ?? [],
    });
    if (qty !== 0) {
      await this.ledgerModel.create({
        tenantId: new Types.ObjectId(tenantId),
        variantId: doc._id as Types.ObjectId,
        delta: qty,
        reason: 'initial',
        note: 'Initial on-hand at variant creation',
      });
      await this.locations.adjust(tenantId, doc._id as Types.ObjectId, qty);
    }
    return doc;
  }

  async getVariant(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const v = await this.variantModel.findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) }).lean().exec();
    if (!v) throw new NotFoundException();
    return v;
  }

  async updateVariant(tenantId: string, id: string, dto: UpdateVariantDto) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.variantModel
      .findOneAndUpdate({ _id: id, tenantId: new Types.ObjectId(tenantId) }, dto, { new: true })
      .lean()
      .exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async removeVariant(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    await this.ledgerModel.deleteMany({ variantId: new Types.ObjectId(id), tenantId: new Types.ObjectId(tenantId) });
    const res = await this.variantModel.findOneAndDelete({ _id: id, tenantId: new Types.ObjectId(tenantId) }).exec();
    if (!res) throw new NotFoundException();
    return { deleted: true };
  }

  async applyStockMovement(
    tenantId: string,
    variantId: string,
    dto: StockMovementDto,
    createdBy?: string,
  ) {
    return this.applyStockMovementWithOrderMeta(tenantId, variantId, dto, createdBy, undefined);
  }

  /**
   * Ledger entries tied to an order (sale / sale_reversal) for idempotent stock on pay/cancel.
   */
  async applyStockMovementWithOrderMeta(
    tenantId: string | undefined,
    variantId: string,
    dto: StockMovementDto,
    createdBy?: string,
    orderId?: Types.ObjectId,
  ) {
    if (!Types.ObjectId.isValid(variantId)) throw new NotFoundException();
    const query: Record<string, any> = { _id: new Types.ObjectId(variantId) };
    if (tenantId) {
      query.tenantId = new Types.ObjectId(tenantId);
    }
    // Atomic $inc guarded by $gte on decrement: avoids a read-then-write race where
    // two concurrent sales could both pass a stale stock check and oversell the
    // last unit (findOne + compare + save is not safe under concurrency).
    const decrementGuard = dto.delta < 0 ? { quantityOnHand: { $gte: -dto.delta } } : {};
    const v = await this.variantModel
      .findOneAndUpdate(
        { ...query, ...decrementGuard },
        { $inc: { quantityOnHand: dto.delta } },
        { new: true },
      )
      .exec();
    if (!v) {
      const exists = await this.variantModel.findOne(query).exec();
      if (!exists) throw new NotFoundException();
      throw new BadRequestException('Stock cannot go negative');
    }
    await this.ledgerModel.create({
      tenantId: v.tenantId,
      variantId: v._id as Types.ObjectId,
      delta: dto.delta,
      reason: dto.reason,
      note: dto.note,
      orderId,
      createdBy: createdBy ? new Types.ObjectId(createdBy) : undefined,
    });
    await this.locations.adjust(String(v.tenantId), v._id as Types.ObjectId, dto.delta);

    // Notify integrations of stock change
    this.eventEmitter.emit('stock.changed', {
      tenantId: String(v.tenantId),
      variantId: String(v._id),
      newQuantity: v.quantityOnHand,
      reason: dto.reason,
    });

    return v.toObject();
  }

  /**
   * Sum of sale + sale_reversal + return deltas for this order line (negative net = stock
   * removed). Inclui 'return' pra evitar dupla contagem: se o módulo returns já devolveu
   * parte/todo o estoque, cancelar/deletar o pedido depois não pode devolver de novo.
   */
  async getNetOrderStockDelta(
    orderId: Types.ObjectId,
    variantId: Types.ObjectId,
    tenantId?: string,
  ): Promise<number> {
    const query: Record<string, any> = {
      orderId,
      variantId,
      reason: { $in: ['sale', 'sale_reversal', 'return'] },
    };
    if (tenantId) {
      query.tenantId = new Types.ObjectId(tenantId);
    }
    const agg = await this.ledgerModel
      .aggregate<{ total: number }>([
        {
          $match: query,
        },
        { $group: { _id: null, total: { $sum: '$delta' } } },
      ])
      .exec();
    return agg[0]?.total ?? 0;
  }

  /**
   * Apply remaining sale delta so net equals -quantitySold (idempotent per line).
   */
  async applySaleDeductionForOrderLine(
    orderId: Types.ObjectId,
    variantId: string,
    quantitySold: number,
    createdBy?: string,
    tenantId?: string,
  ) {
    if (!Types.ObjectId.isValid(variantId)) throw new NotFoundException();
    const vid = new Types.ObjectId(variantId);
    const targetNet = -quantitySold;
    const currentNet = await this.getNetOrderStockDelta(orderId, vid, tenantId);
    const delta = targetNet - currentNet;
    if (delta === 0) return null;
    if (delta > 0) {
      throw new BadRequestException(
        'Inconsistência de estoque do pedido: net maior que o esperado',
      );
    }
    return this.applyStockMovementWithOrderMeta(
      tenantId,
      variantId,
      {
        delta,
        reason: 'sale',
        note: `Venda pedido ${orderId.toString()}`,
      },
      createdBy,
      orderId,
    );
  }

  /**
   * Reverse all sale stock for this order+variant (net sale + sale_reversal → 0).
   */
  async applySaleReversalForOrderVariant(
    orderId: Types.ObjectId,
    variantId: string,
    createdBy?: string,
    tenantId?: string,
  ) {
    if (!Types.ObjectId.isValid(variantId)) throw new NotFoundException();
    const vid = new Types.ObjectId(variantId);
    const currentNet = await this.getNetOrderStockDelta(orderId, vid, tenantId);
    const delta = -currentNet;
    if (delta === 0) return null;
    if (delta < 0) {
      throw new BadRequestException(
        'Não é possível estornar: estoque líquido do pedido inconsistente',
      );
    }
    return this.applyStockMovementWithOrderMeta(
      tenantId,
      variantId,
      {
        delta,
        reason: 'sale_reversal' as StockReason,
        note: `Estorno pedido ${orderId.toString()}`,
      },
      createdBy,
      orderId,
    );
  }

  /** Group lines by variantId and apply sale deltas so net equals minus total qty per variant. */
  async applySaleDeductionsForOrder(
    orderId: Types.ObjectId,
    lines: Array<{ variantId: Types.ObjectId; quantity: number }>,
    createdBy?: string,
    tenantId?: string,
  ) {
    const byVar = new Map<string, number>();
    for (const l of lines) {
      const k = l.variantId.toString();
      byVar.set(k, (byVar.get(k) ?? 0) + l.quantity);
    }
    for (const [vidStr, qty] of byVar) {
      await this.applySaleDeductionForOrderLine(orderId, vidStr, qty, createdBy, tenantId);
    }
  }

  async applySaleReversalsForOrder(
    orderId: Types.ObjectId,
    lines: Array<{ variantId: Types.ObjectId }>,
    createdBy?: string,
    tenantId?: string,
  ) {
    const seen = new Set<string>();
    for (const l of lines) {
      const k = l.variantId.toString();
      if (seen.has(k)) continue;
      seen.add(k);
      await this.applySaleReversalForOrderVariant(orderId, k, createdBy, tenantId);
    }
  }

  async listVariantsNeedingReorder(tenantId?: string) {
    const query: Record<string, any> = {
      $expr: { $lte: ['$quantityOnHand', '$reorderPoint'] },
      reorderPoint: { $gt: 0 },
    };
    if (tenantId) {
      query.tenantId = new Types.ObjectId(tenantId);
    }
    return this.variantModel
      .find(query)
      .populate('productId', 'name slug')
      .lean()
      .exec();
  }

  /** Distinct non-empty categories for active products. */
  async listPublicCatalogCategories(tenantId: string): Promise<string[]> {
    const cats = await this.productModel
      .distinct(
        'category',
        {
          tenantId: new Types.ObjectId(tenantId),
          active: true,
          category: { $nin: [null, ''] },
        } as Record<string, unknown>,
      )
      .exec();
    return (cats as string[])
      .filter((c) => typeof c === 'string' && c.trim().length > 0)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  async getPublicProductBySlug(tenantId: string, slug: string) {
    const p = await this.productModel
      .findOne({ tenantId: new Types.ObjectId(tenantId), slug: slug.toLowerCase().trim(), active: true })
      .lean()
      .exec();
    if (!p) throw new NotFoundException();
    return this.getProduct(tenantId, String(p._id));
  }

  /** Active products with variants for public catalog (no auth). */
  async bulkPatch(
    tenantId: string,
    dto: ProductsBulkPatchDto,
  ): Promise<{
    updated: string[];
    failed: { id: string; error: string }[];
  }> {
    const c = dto.changes;
    if (c.pricePercent !== undefined && c.priceSet !== undefined) {
      throw new UnprocessableEntityException({
        message: 'Informe apenas um entre pricePercent e priceSet',
      });
    }
    if (c.quantityInStockDelta !== undefined && c.quantityInStockSet !== undefined) {
      throw new UnprocessableEntityException({
        message: 'Informe apenas um entre quantityInStockDelta e quantityInStockSet',
      });
    }
    const hasPrice =
      c.pricePercent !== undefined ||
      c.priceSet !== undefined ||
      c.quantityInStockDelta !== undefined ||
      c.quantityInStockSet !== undefined;
    if (!hasPrice) {
      throw new UnprocessableEntityException({
        message: 'Informe ao menos um campo em changes',
      });
    }

    const updated: string[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const id of dto.ids) {
      try {
        if (!Types.ObjectId.isValid(id)) {
          failed.push({ id, error: 'ID inválido' });
          continue;
        }
        const p = await this.productModel.findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) }).exec();
        if (!p) {
          failed.push({ id, error: 'Produto não encontrado' });
          continue;
        }
        if (!p.active) {
          failed.push({ id, error: 'Produto arquivado' });
          continue;
        }
        const variants = await this.variantModel.find({ productId: p._id, tenantId: new Types.ObjectId(tenantId) }).exec();
        if (!variants.length) {
          failed.push({ id, error: 'Sem variantes' });
          continue;
        }
        for (const v of variants) {
          const patch: Record<string, unknown> = {};
          if (c.pricePercent !== undefined) {
            const next = Number(v.price) * (1 + Number(c.pricePercent) / 100);
            patch.price = Math.round(next * 100) / 100;
          }
          if (c.priceSet !== undefined) {
            patch.price = Number(c.priceSet);
          }
          if (c.quantityInStockDelta !== undefined) {
            const nq = Math.floor(
              (v.quantityOnHand ?? 0) + Number(c.quantityInStockDelta),
            );
            if (nq < 0) {
              throw new UnprocessableEntityException({
                message: 'Estoque resultante negativo',
              });
            }
            patch.quantityOnHand = nq;
          }
          if (c.quantityInStockSet !== undefined) {
            const nq = Math.floor(Number(c.quantityInStockSet));
            if (nq < 0) {
              throw new UnprocessableEntityException({
                message: 'Estoque resultante negativo',
              });
            }
            patch.quantityOnHand = nq;
          }
          if (Object.keys(patch).length) {
            await this.variantModel.updateOne({ _id: v._id, tenantId: new Types.ObjectId(tenantId) }, { $set: patch }).exec();
            if (typeof patch.quantityOnHand === 'number') {
              const stockDelta = patch.quantityOnHand - (v.quantityOnHand ?? 0);
              await this.locations.adjust(tenantId, v._id as Types.ObjectId, stockDelta);
            }
          }
        }
        updated.push(id);
      } catch (e) {
        const msg =
          e instanceof UnprocessableEntityException
            ? String((e.getResponse() as { message?: string })?.message ?? e.message)
            : e instanceof Error
              ? e.message
              : 'Erro desconhecido';
        failed.push({ id, error: msg });
      }
    }
    return { updated, failed };
  }

  async listPublicCatalog(tenantId: string): Promise<Record<string, unknown>[]> {
    const raw = await this.productModel
      .aggregate([
        {
          $match: {
            tenantId: new Types.ObjectId(tenantId),
            active: true,
          },
        },
        { $sort: { name: 1 } },
        {
          $lookup: {
            from: 'productvariants',
            localField: '_id',
            foreignField: 'productId',
            as: 'variants',
          },
        },
      ])
      .exec();
    return raw.map((doc) => {
      const p = doc as unknown as Record<string, unknown>;
      const rawVariants = Array.isArray(p.variants) ? p.variants : [];
      const variants = rawVariants.map((v) =>
        this.mapVariantForApi(v as Record<string, unknown>, p),
      );
      return this.enrichProductPricing({ ...p, variants }, variants);
    });
  }
}
