import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { ShippingCarrierAmbiente } from '../../tenants/schemas/tenant.schema';

export type MelhorEnvioCredentials = {
  /** Token com escopo "Cotação de fretes", gerado no painel da Melhor Envio — não exige o fluxo
   *  OAuth completo (que só é necessário pra comprar etiqueta/postagem, fora do escopo deste loop). */
  token: string;
  ambiente: ShippingCarrierAmbiente;
};

export type MelhorEnvioPackage = {
  /** Identificador livre do item na cotação — não precisa ser um SKU real, é só eco no request. */
  id: string;
  widthCm: number;
  heightCm: number;
  lengthCm: number;
  weightKg: number;
  quantity: number;
};

export type MelhorEnvioQuoteOption = {
  serviceId: number;
  carrierName: string;
  serviceName: string;
  /** Em reais — já convertido de string pra number (a API devolve como string, ex. "37.79"). */
  price: number;
  deliveryDays?: number;
};

const BASE_URL: Record<ShippingCarrierAmbiente, string> = {
  sandbox: 'https://sandbox.melhorenvio.com.br',
  producao: 'https://melhorenvio.com.br',
};

/**
 * Loop 27 — thin client pra API de cotação da Melhor Envio (https://docs.melhorenvio.com.br).
 * Molde: `FocusNfeAdapter` (fiscal/adapters) — credenciais passadas por chamada, nunca injetadas no
 * construtor; erro nunca propaga cru, sempre `{ok:false, error}`.
 *
 * Confirmado contra a documentação oficial em 13/08/2026 (request/response abaixo batem com
 * `docs.melhorenvio.com.br/reference/calculo-de-fretes-por-produtos`). IMPORTANTE — igual ao caveat
 * que `FocusNfeAdapter` já registra pra Focus NFe: isto NÃO foi testado contra uma conta real (o
 * tenant ainda não tinha token no momento em que este loop foi implementado). Validar contra
 * sandbox real assim que um token existir, antes de confiar em produção.
 */
@Injectable()
export class MelhorEnvioAdapter {
  private readonly logger = new Logger(MelhorEnvioAdapter.name);

  private baseUrl(ambiente: ShippingCarrierAmbiente): string {
    return BASE_URL[ambiente] ?? BASE_URL.sandbox;
  }

  async calculate(
    creds: MelhorEnvioCredentials,
    from: { postalCode: string },
    to: { postalCode: string },
    packages: MelhorEnvioPackage[],
  ): Promise<{ ok: true; options: MelhorEnvioQuoteOption[] } | { ok: false; error: string }> {
    try {
      const res = await axios.post(
        `${this.baseUrl(creds.ambiente)}/api/v2/me/shipment/calculate`,
        {
          from: { postal_code: from.postalCode },
          to: { postal_code: to.postalCode },
          products: packages.map((p) => ({
            id: p.id,
            width: p.widthCm,
            height: p.heightCm,
            length: p.lengthCm,
            weight: p.weightKg,
            quantity: p.quantity,
          })),
        },
        {
          headers: {
            Authorization: `Bearer ${creds.token}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            // Exigido explicitamente pela doc oficial — requisições sem User-Agent identificável
            // são rejeitadas.
            'User-Agent': 'Kivoni (suporte@kivoni.com.br)',
          },
          timeout: 8_000,
        },
      );
      const raw = Array.isArray(res.data) ? res.data : [];
      // A API pode devolver itens de erro misturados na mesma lista (serviço indisponível pras
      // dimensões informadas, etc.) — só repassa opções com preço numérico válido; quem decide o
      // que fazer com uma lista vazia é o ShippingQuoteService (cai no fallback), não este adapter.
      const options: MelhorEnvioQuoteOption[] = raw
        .filter((item: any) => !item?.error && item?.price !== undefined && item?.price !== null)
        .map((item: any) => ({
          serviceId: Number(item.id),
          carrierName: String(item.company?.name ?? 'Transportadora'),
          serviceName: String(item.name ?? ''),
          price: Number(item.price),
          deliveryDays: item.delivery_time !== undefined ? Number(item.delivery_time) : undefined,
        }))
        .filter((o) => Number.isFinite(o.price));
      return { ok: true, options };
    } catch (error: any) {
      const message = error.response?.data?.message ?? error.message;
      this.logger.warn(`Melhor Envio calculate falhou: ${message}`);
      return { ok: false, error: message };
    }
  }
}
