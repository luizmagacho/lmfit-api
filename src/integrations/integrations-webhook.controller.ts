import {
  Controller,
  Post,
  Param,
  Headers,
  Req,
  Logger,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { SyncEngineService } from './sync-engine.service';
import { IntegrationsService } from './integrations.service';
import { TenantsService } from '../tenants/tenants.service';

@Controller('webhooks/ecommerce')
export class IntegrationsWebhookController {
  private readonly logger = new Logger(IntegrationsWebhookController.name);

  constructor(
    private readonly syncEngine: SyncEngineService,
    private readonly integrationsService: IntegrationsService,
    private readonly tenants: TenantsService,
  ) {}

  /**
   * Recebe notificações inbound das plataformas conectadas. Antes disso o handler só logava e
   * respondia `{received:true}` sem checar nada — qualquer request externo com o path certo era
   * aceito. Agora: resolve o tenant pelo slug, acha a integração ativa daquela plataforma, e exige
   * uma assinatura válida (`adapter.verifyWebhookSignature`, HMAC sobre o corpo bruto) usando o
   * `webhookSecret` daquela integração antes de disparar qualquer coisa. Não reprocessa o payload
   * específico de cada plataforma aqui — dispara uma resincronização real de pedidos
   * (`syncEngine.syncOrders`, já idempotente por `reference`) como reação ao evento validado; a
   * função da API da própria plataforma continua sendo a fonte de verdade dos dados.
   */
  @Post(':platform/:tenantSlug')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Param('platform') platform: string,
    @Param('tenantSlug') slug: string,
    @Headers() headers: Record<string, string>,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const tenant = await this.tenants.findBySlug(slug);
    if (!tenant) {
      this.logger.warn(`Webhook rejeitado: tenant desconhecido (slug=${slug})`);
      throw new ForbiddenException();
    }

    const adapter = this.integrationsService.getAdapter(platform);
    const integration = await this.integrationsService.findByTenantAndPlatform(String(tenant._id), platform);
    if (!integration) {
      this.logger.warn(`Webhook rejeitado: nenhuma integração ativa (tenant=${slug}, platform=${platform})`);
      throw new ForbiddenException();
    }

    if (adapter.verifyWebhookSignature && adapter.webhookSignatureHeader) {
      const secret = integration.webhookSecret;
      const raw = req.rawBody;
      const signature = headers[adapter.webhookSignatureHeader.toLowerCase()];
      let valid = false;
      try {
        // A malformed/wrong-length signature header can make some adapters' timingSafeEqual
        // throw instead of returning false — treat any thrown error the same as "invalid".
        valid = !!secret && raw instanceof Buffer && !!signature && adapter.verifyWebhookSignature(raw, signature, secret);
      } catch {
        valid = false;
      }
      if (!valid) {
        this.logger.warn(`Webhook rejeitado: assinatura inválida (tenant=${slug}, platform=${platform}, integration=${integration._id})`);
        throw new ForbiddenException();
      }
    } else {
      this.logger.warn(
        `Adapter "${platform}" não implementa verificação de assinatura real — aceitando sem validar (integration=${integration._id}).`,
      );
    }

    this.logger.log(`Webhook validado: platform=${platform}, tenant=${slug}, integration=${integration._id}`);

    this.syncEngine.syncOrders(String(tenant._id), String(integration._id)).catch((err: any) => {
      this.logger.error(`Falha ao processar webhook (sync de pedidos) platform=${platform}: ${err.message}`);
    });

    return { received: true };
  }
}
