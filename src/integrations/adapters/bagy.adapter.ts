import { Injectable, Logger } from '@nestjs/common';
import { IntegrationCredentials } from '../schemas/integration.schema';
import {
  PlatformAdapter,
  ExternalProduct,
  ExternalVariant,
  ExternalOrder,
  StockUpdate,
  StockUpdateResult,
  ConnectionTestResult,
} from './platform-adapter.interface';

@Injectable()
export class BagyAdapter implements PlatformAdapter {
  readonly platform = 'bagy';
  private readonly logger = new Logger(BagyAdapter.name);
  private readonly baseUrl = 'https://api.dooca.store';

  private headers(credentials: IntegrationCredentials) {
    return {
      Authorization: `Bearer ${credentials.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async request<T>(credentials: IntegrationCredentials, method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const opts: RequestInit = {
      method,
      headers: this.headers(credentials),
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
      this.logger.warn(`Bagy rate limit hit, retrying after ${retryAfter}s`);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      return this.request<T>(credentials, method, path, body);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bagy API error ${res.status}: ${text}`);
    }

    return res.json() as T;
  }

  async testConnection(credentials: IntegrationCredentials): Promise<ConnectionTestResult> {
    try {
      const data = await this.request<{ data: any[] }>(credentials, 'GET', '/products?limit=1');
      return { ok: true, storeName: 'Loja Bagy' };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async *listProducts(credentials: IntegrationCredentials): AsyncGenerator<ExternalProduct> {
    let page = 1;
    const limit = 50;
    while (true) {
      const data = await this.request<{ data: any[] }>(credentials, 'GET', `/products?page=${page}&limit=${limit}`);
      if (!data.data || data.data.length === 0) break;
      for (const p of data.data) {
        yield this.mapProduct(p);
      }
      if (data.data.length < limit) break;
      page++;
    }
  }

  async getProduct(credentials: IntegrationCredentials, externalId: string): Promise<ExternalProduct> {
    const data = await this.request<{ data: any }>(credentials, 'GET', `/products/${externalId}`);
    return this.mapProduct(data.data);
  }

  async getStock(credentials: IntegrationCredentials, externalVariantId: string): Promise<number> {
    const data = await this.request<{ data: any[] }>(credentials, 'GET', `/stocks?variation_id=${externalVariantId}`);
    return data.data?.[0]?.balance ?? 0;
  }

  async updateStock(credentials: IntegrationCredentials, updates: StockUpdate[]): Promise<StockUpdateResult[]> {
    const results: StockUpdateResult[] = [];
    // Bagy allows max 150 items per batch
    const chunkSize = 150;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);
      const body = chunk.map(u => ({ variation_id: parseInt(u.externalVariantId), balance: u.quantity }));
      try {
        await this.request(credentials, 'PUT', '/stocks', body);
        results.push(...chunk.map(u => ({ externalVariantId: u.externalVariantId, success: true })));
      } catch (err: any) {
        this.logger.error(`Bagy stock update failed for chunk starting at ${i}: ${err.message}`);
        results.push(...chunk.map(u => ({ externalVariantId: u.externalVariantId, success: false, error: err.message })));
      }
    }
    return results;
  }

  async registerWebhook(credentials: IntegrationCredentials, callbackUrl: string, events: string[]): Promise<void> {
    // Bagy webhooks are typically configured via admin panel
    // This is a placeholder for programmatic registration if API supports it
    this.logger.log(`Webhook registration requested for Bagy: ${callbackUrl}, events: ${events.join(', ')}`);
  }

  verifyWebhookSignature(payload: Buffer, signature: string, secret: string): boolean {
    const crypto = require('crypto');
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  private mapProduct(raw: any): ExternalProduct {
    return {
      externalId: String(raw.id),
      name: raw.name || raw.title || '',
      sku: raw.sku,
      barcode: raw.ean || raw.gtin,
      price: raw.price,
      variants: (raw.variations || []).map((v: any) => ({
        externalId: String(v.id),
        sku: v.sku,
        barcode: v.ean || v.gtin,
        color: v.color,
        size: v.size,
        price: v.price,
        stock: v.balance ?? v.stock ?? 0,
      } as ExternalVariant)),
    };
  }
}
