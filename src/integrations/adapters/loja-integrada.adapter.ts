import { Injectable, Logger } from '@nestjs/common';
import { PlatformAdapter } from './platform-adapter.interface';
import { IntegrationPlatform, IntegrationCredentials } from '../schemas/integration.schema';

@Injectable()
export class LojaIntegradaAdapter implements PlatformAdapter {
  platform: IntegrationPlatform = 'loja_integrada';
  private readonly logger = new Logger(LojaIntegradaAdapter.name);

  async testConnection(credentials: IntegrationCredentials): Promise<{ ok: boolean; error?: string }> {
    this.logger.log(`Testing Loja Integrada connection with app key ${credentials.applicationKey}`);
    return { ok: false, error: 'Integração com Loja Integrada ainda não disponível (em breve).' };
  }

  async listProducts(credentials: IntegrationCredentials): Promise<{ id: string; sku: string; name: string }[]> {
    return [];
  }

  async updateStock(credentials: IntegrationCredentials, platformProductId: string, quantity: number): Promise<void> {
    this.logger.log(`[Loja Integrada] Updating stock for product ${platformProductId} to ${quantity}`);
  }

  async registerWebhook(credentials: IntegrationCredentials, webhookUrl: string): Promise<string> {
    return 'mock-webhook-id-loja-integrada';
  }

  verifyWebhookSignature(headers: Record<string, string>, body: any, secret: string): boolean {
    return true; // Mock implementation
  }
}
