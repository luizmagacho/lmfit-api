import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { FiscalAmbiente } from '../../tenants/schemas/tenant.schema';
import type { EmitNfceResult, NfceItem } from './fiscal-types';

export type NuvemFiscalCredentials = {
  clientId: string;
  clientSecret: string;
  ambiente: FiscalAmbiente;
  cnpj: string;
};

export type { NfceItem, EmitNfceResult };

const AUTH_URL = 'https://auth.nuvemfiscal.com.br/oauth/token';
const API_BASE = 'https://api.nuvemfiscal.com.br';

/**
 * Thin client for the Nuvem Fiscal API (https://dev.nuvemfiscal.com.br).
 *
 * IMPORTANT: this adapter is built from Nuvem Fiscal's publicly documented OAuth2
 * client-credentials flow and REST conventions, but has not been exercised against
 * a live account (no sandbox credentials were available while building it). Before
 * flipping any tenant's `fiscal.ambiente` to `producao`, validate the exact NFC-e
 * request/response payload against their current API reference — the auth flow and
 * general resource shape below should hold, but field-level details may need
 * adjustment as their API evolves.
 */
@Injectable()
export class NuvemFiscalAdapter {
  private readonly logger = new Logger(NuvemFiscalAdapter.name);

  private async getAccessToken(creds: NuvemFiscalCredentials): Promise<string> {
    const res = await axios.post(
      AUTH_URL,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        scope: 'nfce',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15_000 },
    );
    const token = res.data?.access_token;
    if (!token) throw new Error('Nuvem Fiscal: token de acesso ausente na resposta');
    return token;
  }

  async testConnection(creds: NuvemFiscalCredentials): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.getAccessToken(creds);
      return { ok: true };
    } catch (error: any) {
      this.logger.error(`Nuvem Fiscal auth failed: ${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  async emitNfce(
    creds: NuvemFiscalCredentials,
    order: { reference: string; items: NfceItem[]; total: number },
  ): Promise<EmitNfceResult> {
    try {
      const token = await this.getAccessToken(creds);
      const res = await axios.post(
        `${API_BASE}/nfce`,
        {
          ambiente: creds.ambiente,
          emitente: { cpf_cnpj: creds.cnpj },
          referencia: order.reference,
          itens: order.items.map((it) => ({
            descricao: it.descricao,
            quantidade: it.quantidade,
            valor_unitario: it.valorUnitario,
            ncm: it.ncm,
          })),
          pagamentos: [{ valor: order.total }],
        },
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          timeout: 20_000,
        },
      );
      const data = res.data ?? {};
      return {
        ok: true,
        providerId: data.id,
        status: data.status,
        chaveAcesso: data.chave_acesso,
        qrCodeUrl: data.url_qrcode,
        danfeUrl: data.url_danfe,
      };
    } catch (error: any) {
      const message = error.response?.data?.message ?? error.message;
      this.logger.error(`Nuvem Fiscal emitNfce failed: ${message}`);
      return { ok: false, error: message };
    }
  }

  async getStatus(creds: NuvemFiscalCredentials, providerId: string): Promise<{ status?: string; error?: string }> {
    try {
      const token = await this.getAccessToken(creds);
      const res = await axios.get(`${API_BASE}/nfce/${providerId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15_000,
      });
      return { status: res.data?.status };
    } catch (error: any) {
      return { error: error.response?.data?.message ?? error.message };
    }
  }
}
