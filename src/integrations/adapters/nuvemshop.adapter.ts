import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import { PlatformAdapter } from './platform-adapter.interface';
import { IntegrationPlatform, IntegrationCredentials } from '../schemas/integration.schema';

@Injectable()
export class NuvemshopAdapter implements PlatformAdapter {
  platform: IntegrationPlatform = 'nuvemshop';
  readonly webhookSignatureHeader = 'x-linkedstore-hmac-sha256';
  private readonly logger = new Logger(NuvemshopAdapter.name);

  async testConnection(credentials: IntegrationCredentials): Promise<{ ok: boolean; storeName?: string; error?: string }> {
    try {
      const response = await axios.get(`https://api.nuvemshop.com.br/v1/${credentials.storeId}/store`, {
        headers: {
          Authentication: `bearer ${credentials.accessToken}`,
          'User-Agent': 'Kivoni (suporte@kivoni.com.br)',
        },
      });
      return { ok: response.status === 200, storeName: response.data?.name?.pt || 'Loja Nuvemshop' };
    } catch (error: any) {
      this.logger.error(`Nuvemshop connection failed: ${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  async *listProducts(credentials: IntegrationCredentials): AsyncGenerator<any> {
    let page = 1;
    const limit = 50;
    while (true) {
      const response = await axios.get(`https://api.nuvemshop.com.br/v1/${credentials.storeId}/products`, {
        params: { page, per_page: limit },
        headers: {
          Authentication: `bearer ${credentials.accessToken}`,
          'User-Agent': 'Kivoni (suporte@kivoni.com.br)',
        },
      }).catch(err => {
        this.logger.error(`Nuvemshop listProducts failed: ${err.message}`);
        return { data: [] };
      });

      const products = response.data;
      if (!products || products.length === 0) break;

      for (const p of products) {
        yield {
          externalId: String(p.id),
          name: p.name?.pt || p.name || '',
          // externalId da variante no formato productId:variantId — updateStock
          // precisa dos dois IDs (a API v1 da Nuvemshop atualiza via /products/:pid/variants/:vid).
          variants: (p.variants || []).map((v: any) => ({
            externalId: `${p.id}:${v.id}`,
            sku: v.sku,
            barcode: v.barcode,
            price: v.price,
            stock: v.stock ?? 0,
            color: v.values?.find((val: any) => val.pt?.toLowerCase()?.includes('cor'))?.pt,
            size: v.values?.find((val: any) => val.pt?.toLowerCase()?.includes('tamanho'))?.pt,
          })),
        };
      }
      if (products.length < limit) break;
      page++;
    }
  }

  async updateStock(credentials: IntegrationCredentials, updates: any[]): Promise<any[]> {
    const results = [];
    for (const update of updates) {
      try {
        // Nuvemshop v1 stock update using product_id and variant_id.
        // If we only have variant_id, we can't easily update via v1 without knowing product_id unless we search.
        // Usually, the system should pass externalId in format "productId:variantId" to make this seamless,
        // but let's assume we can hit the variants endpoint directly if we have the variant ID (v1 actually requires product ID).
        // Since we are mocking the exact implementation for now if we lack product ID:
        const variantId = update.externalVariantId.split(':').pop();
        const productId = update.externalVariantId.split(':')[0];

        if (!productId || productId === variantId) {
          throw new Error('Formato de externalVariantId inválido para Nuvemshop (deveria ser productId:variantId)');
        }

        await axios.put(`https://api.nuvemshop.com.br/v1/${credentials.storeId}/products/${productId}/variants/${variantId}`, {
          stock: update.quantity,
        }, {
          headers: {
            Authentication: `bearer ${credentials.accessToken}`,
            'User-Agent': 'Kivoni (suporte@kivoni.com.br)',
          },
        });
        
        results.push({ externalVariantId: update.externalVariantId, success: true });
      } catch (error: any) {
        this.logger.error(`Nuvemshop updateStock failed for ${update.externalVariantId}: ${error.message}`);
        results.push({ externalVariantId: update.externalVariantId, success: false, error: error.message });
      }
    }
    return results;
  }

  async registerWebhook(credentials: IntegrationCredentials, webhookUrl: string, events: string[]): Promise<void> {
    try {
      for (const event of events) {
        await axios.post(`https://api.nuvemshop.com.br/v1/${credentials.storeId}/webhooks`, {
          event: event, // e.g. 'order/created'
          url: webhookUrl
        }, {
          headers: {
            Authentication: `bearer ${credentials.accessToken}`,
            'User-Agent': 'Kivoni (suporte@kivoni.com.br)',
          },
        });
      }
    } catch (error: any) {
      this.logger.error(`Nuvemshop registerWebhook failed: ${error.message}`);
    }
  }

  verifyWebhookSignature(payload: Buffer, signature: string, secret: string): boolean {
    if (!signature) return false;
    
    const hmac = crypto.createHmac('sha256', secret);
    const digest = hmac.update(payload).digest('hex');
    
    return signature === digest;
  }
}
