import { Injectable, Logger } from '@nestjs/common';
import { PlatformAdapter } from './platform-adapter.interface';
import { IntegrationPlatform, IntegrationCredentials } from '../schemas/integration.schema';

@Injectable()
export class TrayAdapter implements PlatformAdapter {
  platform: IntegrationPlatform = 'tray';
  private readonly logger = new Logger(TrayAdapter.name);

  async testConnection(credentials: IntegrationCredentials): Promise<{ ok: boolean; error?: string }> {
    this.logger.log(`Testing Tray connection for store ${credentials.storeDomain}`);
    return { ok: false, error: 'Integração com Tray ainda não disponível (em breve).' };
  }

  async listProducts(credentials: IntegrationCredentials): Promise<{ id: string; sku: string; name: string }[]> {
    return [];
  }

  async updateStock(credentials: IntegrationCredentials, platformProductId: string, quantity: number): Promise<void> {
    this.logger.log(`[Tray] Updating stock for product ${platformProductId} to ${quantity}`);
  }

  async registerWebhook(credentials: IntegrationCredentials, webhookUrl: string): Promise<string> {
    return 'mock-webhook-id-tray';
  }

  verifyWebhookSignature(headers: Record<string, string>, body: any, secret: string): boolean {
    return true; // Mock implementation
  }
}
