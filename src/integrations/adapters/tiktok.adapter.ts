import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import { PlatformAdapter, ExternalOrder } from './platform-adapter.interface';
import { IntegrationPlatform, IntegrationCredentials } from '../schemas/integration.schema';

const API_BASE = 'https://open-api.tiktokglobalshop.com';
const AUTH_BASE = 'https://auth.tiktok-shops.com';
/** Versão da Order API usada nas rotas abaixo — confirme a mais recente no Partner Center antes de ir pra produção. */
const ORDER_API_VERSION = '202309';

export type TiktokTokenExchangeResult = {
  ok: boolean;
  accessToken?: string;
  refreshToken?: string;
  shopCipher?: string;
  shopId?: string;
  expiresIn?: number;
  error?: string;
};

/**
 * TikTok Shop Partner API (Brasil).
 *
 * Auth: app-level `app_key`/`app_secret` (o app do Kivoni registrado no Partner
 * Center — mapeados aqui em `applicationKey`/`apiKey`, mesma convenção usada pelo
 * ShopeeAdapter) + credenciais por loja obtidas via OAuth (o vendedor autoriza o
 * app; o callback devolve `access_token`, `refresh_token` e `shop_cipher` — os dois
 * últimos guardados em `credentials.refreshToken`/`credentials.shopCipher`).
 * access_token expira em ~90 dias; `refreshAccessToken` troca o refresh_token por
 * um novo par antes que a integração pare de funcionar.
 *
 * Toda chamada é assinada: HMAC-SHA256 sobre `path + query_params_ordenados (+ body
 * se houver)`, chaveado pelo `app_secret`, enviado como parâmetro `sign` — mesmo
 * formato usado por Shopee/Lazada Open Platform (documentado pela TikTok como
 * "Sign your API request").
 *
 * IMPORTANT — não verificado contra uma conta real: o Partner Center renderiza a
 * documentação via JS e não foi possível confirmar a string-base exata da
 * assinatura, nem a versão vigente da Order API (`202309` acima é um chute
 * educado com base na convenção de versionamento deles — pode já ter mudado).
 * Antes de conectar uma loja de verdade, valide os três pontos com o sandbox do
 * Partner Center: (1) construção exata da assinatura, (2) versão da Order API,
 * (3) formato do payload de `POST .../invoice/upload`.
 */
@Injectable()
export class TiktokAdapter implements PlatformAdapter {
  platform: IntegrationPlatform = 'tiktok';
  private readonly logger = new Logger(TiktokAdapter.name);

  private sign(appSecret: string, path: string, params: Record<string, string | number>, body?: unknown): string {
    const sortedKeys = Object.keys(params).sort();
    const paramString = sortedKeys.map((k) => `${k}${params[k]}`).join('');
    const bodyString = body ? JSON.stringify(body) : '';
    const baseString = `${appSecret}${path}${paramString}${bodyString}${appSecret}`;
    return crypto.createHmac('sha256', appSecret).update(baseString).digest('hex');
  }

  private async request(
    method: 'GET' | 'POST',
    credentials: IntegrationCredentials,
    path: string,
    opts: { query?: Record<string, string | number>; body?: unknown } = {},
  ) {
    const { applicationKey: appKey, apiKey: appSecret, accessToken, shopCipher } = credentials;
    if (!appKey || !appSecret || !accessToken) {
      throw new Error('Credenciais TikTok Shop ausentes (app key/secret ou access token)');
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const baseParams: Record<string, string | number> = {
      app_key: appKey,
      timestamp,
      ...(shopCipher ? { shop_cipher: shopCipher } : {}),
      ...(opts.query ?? {}),
    };
    const sign = this.sign(appSecret, path, baseParams, opts.body);
    const params = { ...baseParams, sign };
    const res = await axios.request({
      method,
      url: `${API_BASE}${path}`,
      params,
      data: opts.body,
      headers: {
        'x-tts-access-token': accessToken,
        'Content-Type': 'application/json',
      },
      timeout: 20_000,
    });
    return res.data;
  }

  /** Troca o `auth_code` do redirect de autorização por access/refresh token + shop_cipher. Chamado fora do fluxo de sync, na tela de conexão da loja. */
  async exchangeAuthCode(appKey: string, appSecret: string, authCode: string): Promise<TiktokTokenExchangeResult> {
    try {
      const res = await axios.get(`${AUTH_BASE}/api/v2/token/get`, {
        params: { app_key: appKey, app_secret: appSecret, auth_code: authCode, grant_type: 'authorized_code' },
        timeout: 15_000,
      });
      const data = res.data?.data ?? {};
      if (!data.access_token) {
        return { ok: false, error: res.data?.message ?? 'Resposta sem access_token' };
      }
      return {
        ok: true,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        shopCipher: data.seller_list?.[0]?.cipher,
        shopId: data.seller_list?.[0]?.id,
        expiresIn: data.access_token_expire_in,
      };
    } catch (error: any) {
      const message = error.response?.data?.message ?? error.message;
      this.logger.error(`TikTok token exchange failed: ${message}`);
      return { ok: false, error: message };
    }
  }

  async refreshAccessToken(appKey: string, appSecret: string, refreshToken: string): Promise<TiktokTokenExchangeResult> {
    try {
      const res = await axios.get(`${AUTH_BASE}/api/v2/token/refresh`, {
        params: { app_key: appKey, app_secret: appSecret, refresh_token: refreshToken, grant_type: 'refresh_token' },
        timeout: 15_000,
      });
      const data = res.data?.data ?? {};
      if (!data.access_token) {
        return { ok: false, error: res.data?.message ?? 'Resposta sem access_token' };
      }
      return { ok: true, accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.access_token_expire_in };
    } catch (error: any) {
      const message = error.response?.data?.message ?? error.message;
      this.logger.error(`TikTok token refresh failed: ${message}`);
      return { ok: false, error: message };
    }
  }

  async testConnection(credentials: IntegrationCredentials): Promise<{ ok: boolean; storeName?: string; error?: string }> {
    try {
      const data = await this.request('GET', credentials, '/authorization/202309/shops');
      const shop = data?.data?.shops?.[0];
      return { ok: true, storeName: shop?.name ?? 'Loja TikTok Shop' };
    } catch (error: any) {
      const message = error.response?.data?.message ?? error.message;
      this.logger.error(`TikTok connection failed: ${message}`);
      return { ok: false, error: message };
    }
  }

  /** Puxa pedidos criados/atualizados desde `since` (ou últimas 24h se omitido). */
  async *listOrders(credentials: IntegrationCredentials, since?: Date): AsyncGenerator<ExternalOrder> {
    const createTimeGe = Math.floor((since ?? new Date(Date.now() - 24 * 60 * 60 * 1000)).getTime() / 1000);
    let pageToken: string | undefined;
    do {
      const data = await this.request(
        'POST',
        credentials,
        `/order/${ORDER_API_VERSION}/orders/search`,
        {
          query: { page_size: 50, ...(pageToken ? { page_token: pageToken } : {}) },
          body: { create_time_ge: createTimeGe },
        },
      );
      const orders = data?.data?.orders ?? [];
      for (const o of orders) {
        yield {
          externalId: o.id,
          status: o.status,
          lines: (o.line_items ?? []).map((li: any) => ({
            externalVariantId: li.sku_id ?? li.product_id,
            quantity: 1,
            unitPrice: Number(li.sale_price ?? li.original_price ?? 0),
          })),
          createdAt: o.create_time ? new Date(o.create_time * 1000) : undefined,
        };
      }
      pageToken = data?.data?.next_page_token || undefined;
    } while (pageToken);
  }

  /** Sobe o XML/DANFE da NF-e emitida pro pedido correspondente no TikTok Shop. */
  async uploadInvoice(
    credentials: IntegrationCredentials,
    externalOrderId: string,
    invoice: { fileUrl?: string; base64?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.request('POST', credentials, `/order/${ORDER_API_VERSION}/orders/${externalOrderId}/invoice/upload`, {
        body: invoice.base64 ? { invoice_file: invoice.base64 } : { invoice_url: invoice.fileUrl },
      });
      return { ok: true };
    } catch (error: any) {
      const message = error.response?.data?.message ?? error.message;
      this.logger.error(`TikTok uploadInvoice failed for order ${externalOrderId}: ${message}`);
      return { ok: false, error: message };
    }
  }
}
