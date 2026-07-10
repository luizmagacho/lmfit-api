import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PlatformAdapter, StockUpdate, StockUpdateResult } from './platform-adapter.interface';
import { IntegrationPlatform, IntegrationCredentials } from '../schemas/integration.schema';

const API_BASE = 'https://api.mercadolibre.com';

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
  private readonly logger = new Logger(MercadoLivreAdapter.name);

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
