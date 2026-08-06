import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { EncryptionService } from '../common/encryption.service';
import type { TenantDocument } from '../tenants/schemas/tenant.schema';

/**
 * Loop 11-A — primeira capacidade de ENVIO de mensagem WhatsApp do projeto; até aqui
 * `src/whatsapp/` só recebia (`whatsapp-webhook.controller.ts`). Usa os mesmos campos que o
 * lojista já preenche em Settings (`metaWhatsappPhoneNumberId`/`metaWhatsappAccessToken`),
 * salvos criptografados (ver `TenantsService.updateBranding`).
 */
@Injectable()
export class WhatsappSenderService {
  private readonly log = new Logger(WhatsappSenderService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
  ) {}

  /** Retorna `false` sem lançar quando o tenant não tem credenciais configuradas — chamadores
   *  tratam isso como "não deu pra responder", não como erro de sistema. */
  async sendText(tenant: TenantDocument, to: string, body: string): Promise<boolean> {
    const phoneNumberId = tenant.metaWhatsappPhoneNumberId;
    if (!phoneNumberId) {
      this.log.warn(`Tenant ${tenant.slug}: sem metaWhatsappPhoneNumberId, não é possível enviar.`);
      return false;
    }
    if (!tenant.metaWhatsappAccessToken) {
      this.log.warn(`Tenant ${tenant.slug}: sem metaWhatsappAccessToken, não é possível enviar.`);
      return false;
    }
    const accessToken = this.encryption.decrypt(tenant.metaWhatsappAccessToken);
    const version = this.config.get<string>('META_GRAPH_API_VERSION') ?? 'v21.0';

    await axios.post(
      `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body } },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } },
    );
    return true;
  }
}
