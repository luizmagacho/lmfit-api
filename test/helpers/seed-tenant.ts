import type { INestApplicationContext } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { Tenant, TenantDocument } from '../../src/tenants/schemas/tenant.schema';
import { Product, ProductDocument } from '../../src/products/schemas/product.schema';
import {
  ProductVariant,
  ProductVariantDocument,
} from '../../src/products/schemas/product-variant.schema';

/**
 * Loop 26 — seed próprio pro e2e do caminho do dinheiro, deliberadamente separado de `src/seed/`
 * (que carrega dados de demonstração pensados pra outro propósito e mudam por outros motivos).
 * Insere direto via os models Mongoose — sem passar por `TenantsService`/`ProductsService` — porque
 * o ponto do teste é exercitar `getWholesalePricingBatch()`/`resolveLines()` com dados no formato
 * real, não a camada de escrita administrativa.
 */

export interface SeededTenant {
  tenantId: string;
  slug: string;
}

/** Plano `enterprise` de propósito: destrava a feature `production`, exigida pelo caso E
 *  (backorder) — sem isso `allowBackorder` fica sempre `false` e a linha nunca vira encomenda. */
export async function seedTenant(
  app: INestApplicationContext,
  slugSuffix: string,
): Promise<SeededTenant> {
  const tenantModel = app.get<Model<TenantDocument>>(getModelToken(Tenant.name));
  const slug = `e2e-money-${slugSuffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const tenant = await tenantModel.create({
    slug,
    name: `E2E Money Path (${slugSuffix})`,
    plan: 'enterprise',
    active: true,
  });
  return { tenantId: String(tenant._id), slug };
}

/** Uma linha da matriz A–E do spec (loop-26-money-path-canary.md §Design notes). Deixar
 *  `priceWholesale` indefinido reproduz o caso real (A) — nem variante nem produto configuram
 *  atacado, então `getWholesalePricingBatch()` cai no fallback `priceWholesale = priceRetail`. */
export interface VariantSeed {
  sku: string;
  price: number;
  priceWholesale?: number;
  minWholesaleQty?: number;
  quantityOnHand: number;
  acceptsBackorder?: boolean;
  backorderMinQty?: number;
}

export async function seedProductWithVariant(
  app: INestApplicationContext,
  tenantId: string,
  variant: VariantSeed,
): Promise<{ productId: string; variantId: string }> {
  const productModel = app.get<Model<ProductDocument>>(getModelToken(Product.name));
  const variantModel = app.get<Model<ProductVariantDocument>>(getModelToken(ProductVariant.name));

  const product = await productModel.create({
    tenantId: new Types.ObjectId(tenantId),
    name: `Produto ${variant.sku}`,
    slug: variant.sku.toLowerCase(),
    active: true,
  });

  const createdVariant = await variantModel.create({
    tenantId: new Types.ObjectId(tenantId),
    productId: product._id,
    sku: variant.sku,
    price: variant.price,
    priceWholesale: variant.priceWholesale,
    minWholesaleQty: variant.minWholesaleQty ?? 1,
    quantityOnHand: variant.quantityOnHand,
    acceptsBackorder: variant.acceptsBackorder ?? false,
    backorderMinQty: variant.backorderMinQty ?? 1,
  });

  return { productId: String(product._id), variantId: String(createdVariant._id) };
}
