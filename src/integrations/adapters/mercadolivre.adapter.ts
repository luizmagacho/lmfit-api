import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import { PlatformAdapter, StockUpdate, StockUpdateResult } from './platform-adapter.interface';
import { IntegrationPlatform, IntegrationCredentials } from '../schemas/integration.schema';

const API_BASE = 'https://api.mercadolibre.com';
export type OAuthTokenRefreshResult = { ok: boolean; accessToken?: string; refreshToken?: string; error?: string };

/**
 * Mercado Livre integration.
 *
 * Auth: ML uses OAuth2 (authorization_code + refresh_token) configured per-app on
 * the ML developer portal — this adapter consumes an already-issued `accessToken`
 * (stored on the Integration's credentials) rather than performing the OAuth dance
 * itself, matching how NuvemshopAdapter/ShopifyAdapter are wired in this codebase.
 * Webhook subscriptions on ML are configured statically in the app's dev-portal
 * settings (there is no per-store "create webhook" REST call like Shopify/Nuvemshop),
 * so this adapter intentionally does not implement registerWebhook.
 */
@Injectable()
export class MercadoLivreAdapter implements PlatformAdapter {
  platform: IntegrationPlatform = 'mercadolivre';
  /** Real, documentado pela ML: `x-signature: ts=...,v1=...` nas notificações de webhook v2. */
  readonly webhookSignatureHeader = 'x-signature';
  private readonly logger = new Logger(MercadoLivreAdapter.name);

  /**
   * Verifica `x-signature` de uma notificação ML — formato `ts=<unix>,v1=<hex>`. O manifest
   * assinado é `id:{resourceId};request-id:{xRequestId};ts:{ts};`, HMAC-SHA256 com o client
   * secret do app. Não testado contra uma conta real (sem sandbox disponível aqui) — validar o
   * manifest exato na doc da ML antes de confiar em produção.
   */
  verifyWebhookSignature(payload: Buffer, signatureHeader: string, secret: string, resourceId?: string, requestId?: string): boolean {
    if (!signatureHeader) return false;
    const parts = Object.fromEntries(
      signatureHeader.split(',').map((p) => {
        const [k, v] = p.split('=');
        return [k?.trim(), v?.trim()];
      }),
    );
    const ts = parts.ts;
    const v1 = parts.v1;
    if (!ts || !v1) return false;
    const manifest = `id:${resourceId ?? ''};request-id:${requestId ?? ''};ts:${ts};`;
    const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
    } catch {
      return false;
    }
  }

  /** OAuth2 refresh_token grant — client_id/client_secret mapeados em `applicationKey`/`apiKey` (mesma convenção do TikTok adapter). */
  async refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<OAuthTokenRefreshResult> {
    try {
      const res = await axios.post(
        `${API_BASE}/oauth/token`,
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15_000 },
      );
      if (!res.data?.access_token) {
        return { ok: false, error: 'Resposta sem access_token' };
      }
      return { ok: true, accessToken: res.data.access_token, refreshToken: res.data.refresh_token };
    } catch (error: any) {
      const message = error.response?.data?.message ?? error.message;
      this.logger.error(`Mercado Livre token refresh failed: ${message}`);
      return { ok: false, error: message };
    }
  }

  async testConnection(credentials: IntegrationCredentials): Promise<{ ok: boolean; storeName?: string; error?: string }> {
    if (!credentials.accessToken) {
      return { ok: false, error: 'Integração com Mercado Livre ainda não configurada (falta accessToken).' };
    }
    try {
      const res = await axios.get(`${API_BASE}/users/me`, {
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
        timeout: 15_000,
      });
      return { ok: true, storeName: res.data?.nickname ?? 'Loja Mercado Livre' };
    } catch (error: any) {
      this.logger.error(`Mercado Livre connection failed: ${error.message}`);
      return { ok: false, error: error.response?.data?.message ?? error.message };
    }
  }

  async *listProducts(credentials: IntegrationCredentials): AsyncGenerator<any> {
    if (!credentials.accessToken || !credentials.storeId) return;
    const headers = { Authorization: `Bearer ${credentials.accessToken}` };
    let offset = 0;
    const limit = 50;
    while (true) {
      const search = await axios
        .get(`${API_BASE}/users/${credentials.storeId}/items/search`, {
          headers,
          params: { offset, limit },
          timeout: 15_000,
        })
        .catch((err) => {
          this.logger.error(`Mercado Livre listProducts search failed: ${err.message}`);
          return { data: { results: [] } };
        });
      const ids: string[] = search.data?.results ?? [];
      if (!ids.length) break;

      for (const id of ids) {
        const item = await axios
          .get(`${API_BASE}/items/${id}`, { headers, timeout: 15_000 })
          .catch(() => null);
        if (!item) continue;
        const d = item.data;
        yield {
          externalId: d.id,
          name: d.title,
          sku: d.seller_sku ?? d.id,
          price: d.price,
          variants: (d.variations ?? []).map((v: any) => ({
            externalId: `${d.id}:${v.id}`,
            sku: v.seller_sku ?? String(v.id),
            price: v.price ?? d.price,
            stock: v.available_quantity ?? 0,
          })),
        };
      }
      if (ids.length < limit) break;
      offset += limit;
    }
  }

  async updateStock(credentials: IntegrationCredentials, updates: StockUpdate[]): Promise<StockUpdateResult[]> {
    const results: StockUpdateResult[] = [];
    for (const update of updates) {
      try {
        const [itemId, variationId] = update.externalVariantId.split(':');
        const body = variationId
          ? { variations: [{ id: Number(variationId), available_quantity: update.quantity }] }
          : { available_quantity: update.quantity };
        await axios.put(`${API_BASE}/items/${itemId}`, body, {
          headers: {
            Authorization: `Bearer ${credentials.accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 15_000,
        });
        results.push({ externalVariantId: update.externalVariantId, success: true });
      } catch (error: any) {
        this.logger.error(`Mercado Livre updateStock failed for ${update.externalVariantId}: ${error.message}`);
        results.push({
          externalVariantId: update.externalVariantId,
          success: false,
          error: error.response?.data?.message ?? error.message,
        });
      }
    }
    return results;
  }
}
