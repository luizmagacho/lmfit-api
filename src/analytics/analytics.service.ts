import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { TenantsService } from '../tenants/tenants.service';
import { EncryptionService } from '../common/encryption.service';

export interface PurchaseEventParams {
  orderId: string;
  amount: number;
  currency?: string;
}

/**
 * Loop 15 — dispara o evento "compra" server-side pro pixel de cada provedor configurado pelo
 * tenant, a partir do único ponto do backend onde um pagamento vira `paid` de verdade
 * (`PaymentsService.syncPaymentPaidForOrder`) — cobre Pix, InfinitePay e qualquer confirmação
 * futura igual, sem depender de o comprador voltar pra uma página de confirmação no site (o
 * checkout redireciona pro hospedado da InfinitePay, então o client-side sozinho perderia a
 * maioria das compras reais).
 *
 * Best-effort de propósito, mesma postura já usada pelo resto do projeto pra notificação (Loop
 * 7/8's e-mails): uma falha de rede num provedor de analytics nunca pode impedir o pagamento de
 * ser processado. Cada provedor só dispara se o tenant configurou tanto o ID do pixel quanto o
 * token de servidor daquele provedor — sem o token, o pixel ainda funciona client-side pra
 * page-view/add-to-cart, só não tem o lado servidor da compra.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly tenants: TenantsService,
    private readonly encryption: EncryptionService,
  ) {}

  async trackPurchase(tenantId: string, params: PurchaseEventParams): Promise<void> {
    const tenant = await this.tenants.findById(tenantId).catch(() => null);
    const raw = tenant?.analytics;
    if (!raw) return;
    // Loop 18 — os 3 tokens de servidor chegam criptografados do banco; decrypt() também aceita um
    // valor legado ainda em texto plano sem alteração, então isto é seguro mesmo antes de qualquer
    // tenant ter seus tokens re-salvos depois da criptografia entrar em vigor.
    const cfg = {
      ...raw,
      metaConversionsApiToken: raw.metaConversionsApiToken ? this.encryption.decrypt(raw.metaConversionsApiToken) : undefined,
      ga4ApiSecret: raw.ga4ApiSecret ? this.encryption.decrypt(raw.ga4ApiSecret) : undefined,
      tiktokAccessToken: raw.tiktokAccessToken ? this.encryption.decrypt(raw.tiktokAccessToken) : undefined,
    };

    const currency = params.currency ?? 'BRL';

    await Promise.all([
      this.sendMetaPurchase(cfg, params, currency),
      this.sendGa4Purchase(cfg, params, currency),
      this.sendTiktokPurchase(cfg, params, currency),
    ]);
  }

  private async sendMetaPurchase(cfg: any, params: PurchaseEventParams, currency: string): Promise<void> {
    if (!cfg.metaPixelId || !cfg.metaConversionsApiToken) return;
    try {
      await axios.post(
        `https://graph.facebook.com/v19.0/${cfg.metaPixelId}/events`,
        {
          data: [
            {
              event_name: 'Purchase',
              event_time: Math.floor(Date.now() / 1000),
              action_source: 'system_generated',
              event_id: `order:${params.orderId}`,
              custom_data: {
                currency,
                value: params.amount,
                order_id: params.orderId,
              },
            },
          ],
        },
        { params: { access_token: cfg.metaConversionsApiToken }, timeout: 10_000 },
      );
    } catch (error: any) {
      this.logger.error(`Meta Conversions API purchase event failed (order ${params.orderId}): ${error.response?.data?.error?.message ?? error.message}`);
    }
  }

  private async sendGa4Purchase(cfg: any, params: PurchaseEventParams, currency: string): Promise<void> {
    if (!cfg.ga4MeasurementId || !cfg.ga4ApiSecret) return;
    try {
      // GA4 Measurement Protocol exige um `client_id` de sessão de navegador real pra vincular ao
      // funil client-side — não temos um aqui (evento disparado no servidor, sem contexto de
      // navegador). Um client_id sintético por pedido ainda registra a conversão nos relatórios de
      // e-commerce do GA4, só não se junta a uma sessão de page-view/add-to-cart existente.
      await axios.post(
        'https://www.google-analytics.com/mp/collect',
        {
          client_id: `server.${params.orderId}`,
          events: [
            {
              name: 'purchase',
              params: {
                transaction_id: params.orderId,
                value: params.amount,
                currency,
              },
            },
          ],
        },
        { params: { measurement_id: cfg.ga4MeasurementId, api_secret: cfg.ga4ApiSecret }, timeout: 10_000 },
      );
    } catch (error: any) {
      this.logger.error(`GA4 Measurement Protocol purchase event failed (order ${params.orderId}): ${error.message}`);
    }
  }

  private async sendTiktokPurchase(cfg: any, params: PurchaseEventParams, currency: string): Promise<void> {
    if (!cfg.tiktokPixelId || !cfg.tiktokAccessToken) return;
    try {
      await axios.post(
        'https://business-api.tiktok.com/open_api/v1.3/event/track/',
        {
          event_source: 'web',
          event_source_id: cfg.tiktokPixelId,
          data: [
            {
              event: 'CompletePayment',
              event_time: Math.floor(Date.now() / 1000),
              event_id: `order:${params.orderId}`,
              properties: {
                value: params.amount,
                currency,
                content_id: params.orderId,
              },
            },
          ],
        },
        { headers: { 'Access-Token': cfg.tiktokAccessToken, 'Content-Type': 'application/json' }, timeout: 10_000 },
      );
    } catch (error: any) {
      this.logger.error(`TikTok Events API purchase event failed (order ${params.orderId}): ${error.response?.data?.message ?? error.message}`);
    }
  }
}
