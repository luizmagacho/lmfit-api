import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import { PlatformAdapter, StockUpdate, StockUpdateResult } from './platform-adapter.interface';
import { IntegrationPlatform, IntegrationCredentials } from '../schemas/integration.schema';

const API_BASE = 'https://partner.shopeemobile.com';

/**
 * Shopee integration (Open Platform v2).
 *
 * Auth: every call is signed with HMAC-SHA256 over
 * `partner_id + api_path + timestamp [+ access_token + shop_id]`, keyed by the
 * app's partner_key — there is no bearer-token header like ML/Shopify. Credential
 * mapping onto the shared `IntegrationCredentials` shape (reused as-is, no schema
 * change): `applicationKey` = partner_id, `apiKey` = partner_key,
 * `storeId` = shop_id, `accessToken` = shop-level access_token (issued via Shopee's
 * OAuth authorize flow, performed outside this adapter). As with the Nuvem Fiscal
 * adapter, this was built from Shopee's public API reference without a live
 * sandbox shop to test against — validate exact field names before going live.
 */
@Injectable()
export class ShopeeAdapter implements PlatformAdapter {
  platform: IntegrationPlatform = 'shopee';
  private readonly logger = new Logger(ShopeeAdapter.name);

  private sign(partnerId: string, partnerKey: string, path: string, extra = ''): { timestamp: number; sign: string } {
    const timestamp = Math.floor(Date.now() / 1000);
    const baseString = `${partnerId}${path}${timestamp}${extra}`;
    const sign = crypto.createHmac('sha256', partnerKey).update(baseString).digest('hex');
    return { timestamp, sign };
  }

  async testConnection(credentials: IntegrationCredentials): Promise<{ ok: boolean; storeName?: string; error?: string }> {
    const { applicationKey: partnerId, apiKey: partnerKey, storeId: shopId, accessToken } = credentials;
    if (!partnerId || !partnerKey || !shopId || !accessToken) {
      return { ok: false, error: 'Integração com Shopee ainda não configurada (faltam credenciais do app).' };
    }
    const path = '/api/v2/shop/get_shop_info';
    const { timestamp, sign } = this.sign(partnerId, partnerKey, path, `${accessToken}${shopId}`);
    try {
      const res = await axios.get(`${API_BASE}${path}`, {
        params: {
          partner_id: partnerId,
          timestamp,
          sign,
          shop_id: shopId,
          access_token: accessToken,
        },
        timeout: 15_000,
      });
      return { ok: true, storeName: res.data?.shop_name ?? 'Loja Shopee' };
    } catch (error: any) {
      this.logger.error(`Shopee connection failed: ${error.message}`);
      return { ok: false, error: error.response?.data?.message ?? error.message };
    }
  }

  async updateStock(credentials: IntegrationCredentials, updates: StockUpdate[]): Promise<StockUpdateResult[]> {
    const { applicationKey: partnerId, apiKey: partnerKey, storeId: shopId, accessToken } = credentials;
    const results: StockUpdateResult[] = [];
    if (!partnerId || !partnerKey || !shopId || !accessToken) {
      return updates.map((u) => ({
        externalVariantId: u.externalVariantId,
        success: false,
        error: 'Credenciais Shopee ausentes',
      }));
    }
    const path = '/api/v2/product/update_stock';
    for (const update of updates) {
      try {
        const [itemId, modelId] = update.externalVariantId.split(':');
        const { timestamp, sign } = this.sign(partnerId, partnerKey, path, `${accessToken}${shopId}`);
        const stockList = modelId
          ? [{ model_id: Number(modelId), seller_stock: [{ stock: update.quantity }] }]
          : undefined;
        await axios.post(
          `${API_BASE}${path}`,
          {
            item_id: Number(itemId),
            stock_list: stockList ?? [{ seller_stock: [{ stock: update.quantity }] }],
          },
          {
            params: { partner_id: partnerId, timestamp, sign, shop_id: shopId, access_token: accessToken },
            headers: { 'Content-Type': 'application/json' },
            timeout: 15_000,
          },
        );
        results.push({ externalVariantId: update.externalVariantId, success: true });
      } catch (error: any) {
        this.logger.error(`Shopee updateStock failed for ${update.externalVariantId}: ${error.message}`);
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
