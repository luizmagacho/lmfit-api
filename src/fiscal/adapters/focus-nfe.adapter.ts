import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { FiscalAmbiente } from '../../tenants/schemas/tenant.schema';
import type { EmitNfceResult, NfceItem } from './fiscal-types';

export type FocusNfeCredentials = {
  /** Token gerado no cadastro da empresa emitente no painel Focus NFe. */
  token: string;
  ambiente: FiscalAmbiente;
  cnpj: string;
};

const BASE_URL: Record<FiscalAmbiente, string> = {
  homologacao: 'https://homologacao.focusnfe.com.br',
  producao: 'https://api.focusnfe.com.br',
};

/**
 * Thin client for the Focus NFe API (https://doc.focusnfe.com.br).
 *
 * Confirmed from Focus NFe's public docs: HTTP Basic Auth (token as username,
 * blank password), base URLs split by ambiente, `POST /v2/nfce` processes
 * synchronously (authorization comes back in the same request) — no polling
 * needed for the happy path, `getStatus` below is a fallback/reconciliation path.
 *
 * IMPORTANT — NOT verified against a live account: their reference site renders
 * via JS and the exact request-body field names for `itens`/`cliente`/forma de
 * pagamento could not be scraped while building this. The field names below
 * (`valor_unitario_comercial`, `cfop`, `forma_pagamento`, …) follow the
 * conventions used across Focus NFe's own NF-e/NFC-e docs and their sister
 * products, but must be validated with a homologação token before flipping any
 * tenant's `fiscal.ambiente` to `producao` — same caveat this codebase already
 * carries for `NuvemFiscalAdapter` and the Shopee/ML integration adapters.
 */
@Injectable()
export class FocusNfeAdapter {
  private readonly logger = new Logger(FocusNfeAdapter.name);

  private baseUrl(ambiente: FiscalAmbiente): string {
    return BASE_URL[ambiente] ?? BASE_URL.homologacao;
  }

  private authConfig(creds: FocusNfeCredentials) {
    return { auth: { username: creds.token, password: '' }, timeout: 20_000 };
  }

  async testConnection(creds: FocusNfeCredentials): Promise<{ ok: boolean; error?: string }> {
    try {
      await axios.get(`${this.baseUrl(creds.ambiente)}/v2/nfce`, {
        ...this.authConfig(creds),
        params: { cnpj_emitente: creds.cnpj, limite: 1 },
      });
      return { ok: true };
    } catch (error: any) {
      const message = error.response?.data?.mensagem ?? error.message;
      this.logger.error(`Focus NFe auth failed: ${message}`);
      return { ok: false, error: message };
    }
  }

  async emitNfce(
    creds: FocusNfeCredentials,
    order: { reference: string; items: NfceItem[]; total: number },
  ): Promise<EmitNfceResult> {
    try {
      const res = await axios.post(
        `${this.baseUrl(creds.ambiente)}/v2/nfce`,
        {
          cnpj_emitente: creds.cnpj,
          referencia: order.reference,
          presenca_comprador: 4, // venda por aplicativo/plataforma
          itens: order.items.map((it, idx) => ({
            numero_item: idx + 1,
            descricao: it.descricao,
            quantidade: it.quantidade,
            valor_unitario_comercial: it.valorUnitario,
            valor_unitario_tributavel: it.valorUnitario,
            valor_bruto: Number((it.quantidade * it.valorUnitario).toFixed(2)),
            ncm: it.ncm ?? '00000000',
            cfop: '5102',
            unidade_comercial: 'UN',
            unidade_tributavel: 'UN',
          })),
          formas_pagamento: [{ forma_pagamento: '01', valor_pagamento: order.total }],
        },
        this.authConfig(creds),
      );
      const data = res.data ?? {};
      return {
        ok: data.status === 'autorizado' || !!data.chave_nfe,
        providerId: data.ref ?? order.reference,
        status: data.status,
        chaveAcesso: data.chave_nfe,
        qrCodeUrl: data.qrcode_url,
        danfeUrl: data.caminho_danfe,
        error: data.status === 'erro_autorizacao' ? (data.mensagem_sefaz ?? data.mensagem) : undefined,
      };
    } catch (error: any) {
      const message = error.response?.data?.mensagem ?? error.message;
      this.logger.error(`Focus NFe emitNfce failed: ${message}`);
      return { ok: false, error: message };
    }
  }

  async getStatus(creds: FocusNfeCredentials, providerRef: string): Promise<{ status?: string; error?: string }> {
    try {
      const res = await axios.get(`${this.baseUrl(creds.ambiente)}/v2/nfce/${providerRef}`, this.authConfig(creds));
      return { status: res.data?.status };
    } catch (error: any) {
      return { error: error.response?.data?.mensagem ?? error.message };
    }
  }
}
