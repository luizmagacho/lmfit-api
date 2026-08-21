import { ForbiddenException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

/**
 * Regression test for a real security bug found in a live security review: `ingest()` only ran
 * HMAC signature verification inside `if (secret) { ... }` — when no `metaAppSecret` was configured
 * for a tenant AND no global `META_APP_SECRET` env var existed, that whole block was skipped and
 * ANY unauthenticated payload was accepted, letting an attacker forge inbound WhatsApp messages
 * (including a spoofed `fromWaId` impersonating an allowlisted staff number, which drives real
 * order/purchase creation via `InboundMessageProcessor`). Fixed to fail CLOSED instead.
 */
describe('WhatsappWebhookController', () => {
  const slug = 'lmfit';
  const secret = 'app-secret';
  const body = Buffer.from(JSON.stringify({ entry: [] }));
  const validSig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

  const tenant = { _id: 'tenant-1', metaAppSecret: undefined as string | undefined };
  const config: any = { get: jest.fn().mockReturnValue(undefined) };
  const messages: any = { createInbound: jest.fn() };
  const processor: any = { process: jest.fn().mockResolvedValue(undefined) };
  const tenants: any = { findBySlug: jest.fn().mockResolvedValue(tenant) };
  const encryption: any = { decrypt: jest.fn((v: string) => v) };

  const controller = new WhatsappWebhookController(config, messages, processor, tenants, encryption);

  function req(rawBody: Buffer) {
    return { rawBody } as any;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    tenant.metaAppSecret = undefined;
    config.get.mockReturnValue(undefined);
    tenants.findBySlug.mockResolvedValue(tenant);
    encryption.decrypt.mockImplementation((v: string) => v);
  });

  it('rejects when the tenant slug does not resolve', async () => {
    tenants.findBySlug.mockResolvedValueOnce(null);
    await expect(controller.ingest(slug, validSig, req(body), {})).rejects.toThrow(ForbiddenException);
    expect(messages.createInbound).not.toHaveBeenCalled();
  });

  it('fails CLOSED when no secret is configured anywhere (tenant nor global env)', async () => {
    await expect(controller.ingest(slug, validSig, req(body), {})).rejects.toThrow(ForbiddenException);
    expect(messages.createInbound).not.toHaveBeenCalled();
  });

  it('rejects a missing raw body even with a secret configured', async () => {
    tenant.metaAppSecret = secret;
    await expect(
      controller.ingest(slug, validSig, req(undefined as unknown as Buffer), {}),
    ).rejects.toThrow(ForbiddenException);
    expect(messages.createInbound).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature', async () => {
    tenant.metaAppSecret = secret;
    await expect(controller.ingest(slug, 'sha256=wrong', req(body), {})).rejects.toThrow(ForbiddenException);
    expect(messages.createInbound).not.toHaveBeenCalled();
  });

  it('rejects a missing signature header entirely', async () => {
    tenant.metaAppSecret = secret;
    await expect(controller.ingest(slug, undefined, req(body), {})).rejects.toThrow(ForbiddenException);
    expect(messages.createInbound).not.toHaveBeenCalled();
  });

  it('accepts a valid signature (tenant-level secret) and processes the payload', async () => {
    tenant.metaAppSecret = secret;
    const result = await controller.ingest(slug, validSig, req(body), { entry: [] });
    expect(result).toEqual({});
  });

  it('accepts a valid signature using the global META_APP_SECRET fallback', async () => {
    config.get.mockReturnValue(secret);
    const result = await controller.ingest(slug, validSig, req(body), { entry: [] });
    expect(result).toEqual({});
  });
});
