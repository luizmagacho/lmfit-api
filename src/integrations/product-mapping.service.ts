import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductMapping, ProductMappingDocument } from './schemas/product-mapping.schema';
import { ProductVariant } from '../products/schemas/product-variant.schema';

@Injectable()
export class ProductMappingService {
  private readonly logger = new Logger(ProductMappingService.name);

  constructor(
    @InjectModel(ProductMapping.name) private readonly model: Model<ProductMapping>,
    @InjectModel(ProductVariant.name) private readonly variantModel: Model<ProductVariant>,
  ) {}

  async findByVariant(integrationId: string, variantId: string): Promise<ProductMappingDocument | null> {
    return this.model.findOne({
      integrationId: new Types.ObjectId(integrationId),
      variantId: new Types.ObjectId(variantId),
      status: 'active',
    }).exec();
  }

  async findByExternalVariant(integrationId: string, externalVariantId: string): Promise<ProductMappingDocument | null> {
    return this.model.findOne({
      integrationId: new Types.ObjectId(integrationId),
      externalVariantId,
      status: 'active',
    }).exec();
  }

  async findAllByIntegration(integrationId: string): Promise<ProductMappingDocument[]> {
    return this.model.find({ integrationId: new Types.ObjectId(integrationId) }).exec();
  }

  async createMapping(data: {
    tenantId: string;
    integrationId: string;
    productId: string;
    variantId?: string;
    externalProductId: string;
    externalVariantId?: string;
    externalSku?: string;
  }): Promise<ProductMappingDocument> {
    return this.model.create({
      tenantId: new Types.ObjectId(data.tenantId),
      integrationId: new Types.ObjectId(data.integrationId),
      productId: new Types.ObjectId(data.productId),
      variantId: data.variantId ? new Types.ObjectId(data.variantId) : undefined,
      externalProductId: data.externalProductId,
      externalVariantId: data.externalVariantId,
      externalSku: data.externalSku,
    });
  }

  async autoMapBySku(tenantId: string, integrationId: string, externalProducts: Array<{ externalId: string; variants?: Array<{ externalId: string; sku?: string }> }>): Promise<{ mapped: number; unmapped: number }> {
    let mapped = 0;
    let unmapped = 0;

    for (const ep of externalProducts) {
      for (const ev of (ep.variants || [])) {
        if (!ev.sku) { unmapped++; continue; }

        const variant = await this.variantModel.findOne({
          tenantId: new Types.ObjectId(tenantId),
          sku: ev.sku,
        }).exec();

        if (variant) {
          const existing = await this.model.findOne({
            integrationId: new Types.ObjectId(integrationId),
            variantId: variant._id,
          }).exec();

          if (!existing) {
            await this.createMapping({
              tenantId,
              integrationId,
              productId: variant.productId.toString(),
              variantId: variant._id.toString(),
              externalProductId: ep.externalId,
              externalVariantId: ev.externalId,
              externalSku: ev.sku,
            });
            mapped++;
          }
        } else {
          unmapped++;
        }
      }
    }

    this.logger.log(`Auto-map by SKU: ${mapped} mapped, ${unmapped} unmapped`);
    return { mapped, unmapped };
  }

  async removeByIntegration(integrationId: string): Promise<void> {
    await this.model.deleteMany({ integrationId: new Types.ObjectId(integrationId) }).exec();
  }
}
