import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { EncryptionService } from '../common/encryption.service';
import type { TenantDocument } from '../tenants/schemas/tenant.schema';

/**
 * Loop 12-A — baixa o conteúdo real de uma mensagem de mídia do WhatsApp. A Meta nunca manda o
 * arquivo dentro do próprio webhook, só um ID (`msg.audio.id`) — é preciso 2 chamadas na Graph
 * API: uma pra trocar o ID por uma URL assinada de download, outra pra baixar os bytes de fato.
 * Mesma credencial que `WhatsappSenderService` já usa pra enviar mensagem (não precisa do
 * `phoneNumberId`, só do access token — o download é autorizado pelo próprio token).
 */
@Injectable()
export class WhatsappMediaService {
  private readonly log = new Logger(WhatsappMediaService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
  ) {}

  /** `null` quando o tenant não tem token configurado ou a Meta recusa o download — chamador
   *  trata como "não deu pra processar este áudio", não como erro de sistema. */
  async downloadAudio(tenant: TenantDocument, mediaId: string): Promise<Buffer | null> {
    if (!tenant.metaWhatsappAccessToken) {
      this.log.warn(`Tenant ${tenant.slug}: sem metaWhatsappAccessToken, não é possível baixar mídia.`);
      return null;
    }
    const accessToken = this.encryption.decrypt(tenant.metaWhatsappAccessToken);
    const version = this.config.get<string>('META_GRAPH_API_VERSION') ?? 'v21.0';
    const headers = { Authorization: `Bearer ${accessToken}` };

    try {
      const { data: meta } = await axios.get<{ url?: string }>(
        `https://graph.facebook.com/${version}/${mediaId}`,
        { headers },
      );
      if (!meta.url) {
        this.log.warn(`Tenant ${tenant.slug}: mídia ${mediaId} sem URL de download na resposta da Meta.`);
        return null;
      }
      const { data } = await axios.get<ArrayBuffer>(meta.url, {
        headers,
        responseType: 'arraybuffer',
      });
      return Buffer.from(data);
    } catch (e) {
      this.log.warn(`Tenant ${tenant.slug}: falha ao baixar mídia ${mediaId}: ${String(e)}`);
      return null;
    }
  }
}
