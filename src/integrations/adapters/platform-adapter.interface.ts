import { IntegrationCredentials } from '../schemas/integration.schema';

export interface ExternalProduct {
  externalId: string;
  name: string;
  sku?: string;
  barcode?: string;
  price?: number;
  variants?: ExternalVariant[];
}

export interface ExternalVariant {
  externalId: string;
  sku?: string;
  barcode?: string;
  color?: string;
  size?: string;
  price?: number;
  stock?: number;
}

export interface ExternalOrder {
  externalId: string;
  status: string;
  lines: Array<{
    externalVariantId: string;
    quantity: number;
    unitPrice: number;
  }>;
  createdAt?: Date;
}

export interface StockUpdate {
  externalVariantId: string;
  quantity: number;
}

export interface StockUpdateResult {
  externalVariantId: string;
  success: boolean;
  error?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  storeName?: string;
  error?: string;
}

export interface PlatformAdapter {
  readonly platform: string;
  testConnection(credentials: IntegrationCredentials): Promise<any>;
  listProducts?(credentials: IntegrationCredentials): any;
  getProduct?(credentials: IntegrationCredentials, externalId: string): Promise<any>;
  createProduct?(credentials: IntegrationCredentials, product: any): Promise<any>;
  updateProduct?(credentials: IntegrationCredentials, externalId: string, product: any): Promise<any>;
  getStock?(credentials: IntegrationCredentials, externalVariantId: string): Promise<number>;
  updateStock?(...args: any[]): Promise<any>;
  listOrders?(credentials: IntegrationCredentials, since?: Date): any;
  registerWebhook?(...args: any[]): Promise<any>;
  verifyWebhookSignature?(...args: any[]): boolean;
}
