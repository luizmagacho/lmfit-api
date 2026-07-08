import { Controller, Post, Param, Req, Logger, HttpCode, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { SyncEngineService } from './sync-engine.service';
import { IntegrationsService } from './integrations.service';

@Controller('webhooks/ecommerce')
export class IntegrationsWebhookController {
  private readonly logger = new Logger(IntegrationsWebhookController.name);

  constructor(
    private readonly syncEngine: SyncEngineService,
    private readonly integrationsService: IntegrationsService,
  ) {}

  @Post(':platform/:tenantSlug')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Param('platform') platform: string,
    @Param('tenantSlug') slug: string,
    @Req() req: any,
  ) {
    this.logger.log(`Inbound webhook: platform=${platform}, tenant=${slug}`);

    // For now, log and acknowledge. Full webhook processing will be
    // implemented per-platform as adapters are expanded.
    return { received: true };
  }
}
