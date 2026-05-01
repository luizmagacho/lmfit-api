import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { extractInboundMessages } from './meta-webhook.parser';
import { InboundMessageProcessor } from './inbound-message.processor';
import { WhatsappMessagesService } from './whatsapp-messages.service';

@ApiTags('webhooks')
@SkipThrottle()
@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  private readonly log = new Logger(WhatsappWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly messages: WhatsappMessagesService,
    private readonly processor: InboundMessageProcessor,
  ) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    const expected = this.config.get<string>('META_WHATSAPP_VERIFY_TOKEN');
    if (mode === 'subscribe' && token && expected && token === expected) {
      return challenge;
    }
    throw new ForbiddenException();
  }

  @Post()
  @HttpCode(200)
  async ingest(
    @Headers('x-hub-signature-256') sig: string | undefined,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: Record<string, unknown>,
  ) {
    const secret = this.config.get<string>('META_APP_SECRET');
    const raw = req.rawBody;
    if (secret) {
      if (!(raw instanceof Buffer)) {
        this.log.warn('META_APP_SECRET set but raw body missing; rejecting');
        throw new ForbiddenException();
      }
      const expected =
        'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
      const ok =
        typeof sig === 'string' &&
        sig.length === expected.length &&
        timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
      if (!ok) throw new ForbiddenException();
    }

    const inbound = extractInboundMessages(body);
    if (!inbound.length) {
      return {};
    }
    for (const m of inbound) {
      if (!m.textBody?.trim()) continue;
      const created = await this.messages.createInbound({
        wamid: m.wamid,
        fromWaId: m.fromWaId,
        type: m.type,
        textBody: m.textBody,
        rawPayload: body,
      });
      if (!created) continue;
      void this.processor.process(created).catch((e) => {
        this.log.error(e);
        void this.messages.updateOne(m.wamid, {
          processingStatus: 'failed',
          error: String(e),
        });
      });
    }
    return {};
  }
}
