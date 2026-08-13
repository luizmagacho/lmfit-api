import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EncryptionService } from '../common/encryption.service';
import { Product } from '../products/schemas/product.schema';
import { ProductVariant } from '../products/schemas/product-variant.schema';
import { TenantsService } from '../tenants/tenants.service';
import { MelhorEnvioAdapter } from './adapters/melhor-envio.adapter';
import type { ShippingQuoteLineDto } from './dto/quote-shipping.dto';

export interface ShippingQuoteOption {
  /** `'pickup'` | `'standard'` | `'express'` (fallback fixo) ou `'me:<serviceId>'` (Melhor Envio real). */
  method: string;
  label: string;
  price: number;
  deliveryDays?: number;
  isPickup?: boolean;
}

const DEFAULT_STANDARD_FEE = 19.9;
const DEFAULT_EXPRESS_FEE = 39.9;

/**
 * Loop 27 — porta de entrada única pra qualquer cotação de frete, pública ou pro draft/pedido.
 * Cai automaticamente no fallback de taxa fixa (comportamento de hoje, byte a byte) sempre que:
 * (1) o tenant não tem token da Melhor Envio configurado, (2) algum produto do carrinho não tem
 * peso/dimensões cadastrados, ou (3) a chamada à API falha por qualquer motivo. O cliente nunca vê
 * um erro de frete — na pior das hipóteses, vê a mesma estimativa fixa que já via antes deste loop.
 */
@Injectable()
export class ShippingQuoteService {
  private readonly logger = new Logger(ShippingQuoteService.name);

  constructor(
    @InjectModel(ProductVariant.name) private readonly variantModel: Model<ProductVariant>,
    @InjectModel(Product.name) private readonly productModel: Model<Product>,
    private readonly tenants: TenantsService,
    private readonly encryption: EncryptionService,
    private readonly melhorEnvio: MelhorEnvioAdapter,
  ) {}

  async quote(
    tenantId: string,
    destinationCep: string,
    lines: ShippingQuoteLineDto[],
  ): Promise<ShippingQuoteOption[]> {
    const digits = destinationCep.replace(/\D/g, '');
    if (digits.length !== 8) {
      throw new BadRequestException('CEP de destino inválido');
    }

    const tenant = await this.tenants.findById(tenantId);
    const cfg = tenant?.shippingConfig;
    const subtotal = 0; // resolvido por quem chama quando precisar da isenção — ver fallback() abaixo

    const fallback = this.fallbackOptions(cfg);

    const token = this.resolveToken(cfg?.melhorEnvio?.token);
    const originCep = cfg?.originAddress?.cep?.replace(/\D/g, '');
    if (!token || !originCep || originCep.length !== 8) {
      return fallback;
    }

    const packages = await this.resolvePackages(tenantId, lines);
    if (!packages) {
      // Algum produto do carrinho não tem peso/dimensões cadastrados — nunca cota com dado incompleto.
      return fallback;
    }

    const result = await this.melhorEnvio.calculate(
      { token, ambiente: cfg!.melhorEnvio!.ambiente ?? 'sandbox' },
      { postalCode: originCep },
      { postalCode: digits },
      packages,
    );

    if (!result.ok || result.options.length === 0) {
      return fallback;
    }

    const real: ShippingQuoteOption[] = result.options.map((o) => ({
      method: `me:${o.serviceId}`,
      label: `${o.serviceName} (${o.carrierName})`,
      price: o.price,
      deliveryDays: o.deliveryDays,
    }));

    // A retirada em loja continua sempre disponível — cotação real nunca a substitui.
    const pickup = fallback.find((f) => f.method === 'pickup');
    return pickup ? [pickup, ...real] : real;
  }

  /** Mesma lógica de `order-drafts.service.ts`'s `computeShippingCost` — ver Loop 3/13. Mantida aqui
   *  em vez de importada pra não criar uma dependência de módulo em ambas as direções; se divergir,
   *  os testes de regressão do AC7 (spec do Loop 27) pegam. */
  private fallbackOptions(cfg?: {
    pickupLabel?: string;
    standardFee?: number;
    expressFee?: number;
  }): ShippingQuoteOption[] {
    return [
      { method: 'pickup', label: cfg?.pickupLabel || 'Retirada em Loja', price: 0, isPickup: true },
      { method: 'standard', label: 'Entrega padrão', price: cfg?.standardFee ?? DEFAULT_STANDARD_FEE },
      { method: 'express', label: 'Entrega expressa', price: cfg?.expressFee ?? DEFAULT_EXPRESS_FEE },
    ];
  }

  private resolveToken(raw?: string): string | undefined {
    if (!raw) return undefined;
    try {
      return this.encryption.decrypt(raw);
    } catch (err) {
      this.logger.warn(`Falha ao descriptografar o token da Melhor Envio: ${(err as Error).message}`);
      return undefined;
    }
  }

  /** Agrega peso/dimensões do carrinho real → um "pacote" por linha. Devolve `null` (não lança) se
   *  qualquer produto envolvido não tiver as 4 medidas cadastradas — o chamador decide cair no
   *  fallback, isso aqui só constata o dado incompleto. */
  private async resolvePackages(
    tenantId: string,
    lines: ShippingQuoteLineDto[],
  ): Promise<{ id: string; widthCm: number; heightCm: number; lengthCm: number; weightKg: number; quantity: number }[] | null> {
    const variantIds = lines.map((l) => l.variantId);
    const variants = await this.variantModel
      .find({ _id: { $in: variantIds }, tenantId: new Types.ObjectId(tenantId) })
      .lean()
      .exec();
    const variantById = new Map(variants.map((v) => [String(v._id), v]));

    const productIds = [...new Set(variants.map((v) => String(v.productId)))];
    const products = await this.productModel
      .find({ _id: { $in: productIds.map((id) => new Types.ObjectId(id)) }, tenantId: new Types.ObjectId(tenantId) })
      .lean()
      .exec();
    const productById = new Map(products.map((p) => [String(p._id), p]));

    const packages: { id: string; widthCm: number; heightCm: number; lengthCm: number; weightKg: number; quantity: number }[] = [];
    for (const line of lines) {
      const variant = variantById.get(line.variantId);
      if (!variant) return null;
      const product = productById.get(String(variant.productId));
      if (!product) return null;
      const { widthCm, heightCm, lengthCm, weightGrams } = product;
      if (!widthCm || !heightCm || !lengthCm || !weightGrams) return null;
      packages.push({
        id: line.variantId,
        widthCm,
        heightCm,
        lengthCm,
        weightKg: weightGrams / 1000,
        quantity: line.quantity,
      });
    }
    return packages;
  }
}
