import { Injectable, Logger } from '@nestjs/common';
import { PlatformAdapter } from './platform-adapter.interface';
import { IntegrationPlatform, IntegrationCredentials } from '../schemas/integration.schema';

@Injectable()
export class ShopifyAdapter implements PlatformAdapter {
  platform: IntegrationPlatform = 'shopify';
  private readonly logger = new Logger(ShopifyAdapter.name);

  async testConnection(credentials: IntegrationCredentials): Promise<{ ok: boolean; error?: string }> {
    this.logger.log(`Testing Shopify connection for store ${credentials.storeDomain}`);
    return { ok: false, error: 'Integração com Shopify ainda não disponível (em breve).' };
  }

  async listProducts(credentials: IntegrationCredentials): Promise<{ id: string; sku: string; name: string }[]> {
    return [];
  }

  async updateStock(credentials: IntegrationCredentials, platformProductId: string, quantity: number): Promise<void> {
    this.logger.log(`[Shopify] Updating stock for product ${platformProductId} to ${quantity}`);
  }

  async registerWebhook(credentials: IntegrationCredentials, webhookUrl: string): Promise<string> {
    return 'mock-webhook-id-shopify';
  }

  verifyWebhookSignature(headers: Record<string, string>, body: any, secret: string): boolean {
    return true; // Mock implementation
  }
}
