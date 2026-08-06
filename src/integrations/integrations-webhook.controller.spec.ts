import { ForbiddenException } from '@nestjs/common';
import * as crypto from 'crypto';
import { IntegrationsWebhookController } from './integrations-webhook.controller';

/**
 * Regression test for the pre-existing no-op webhook receptor: it used to log and return
 * `{received:true}` for literally any request. These tests prove the new receptor actually
 * gates on tenant existence, integration existence, and a valid per-platform signature — and only
 * dispatches a real sync when all three hold.
 */
describe('IntegrationsWebhookController', () => {
  const secret = 'webhook-secret';
  const body = Buffer.from(JSON.stringify({ event: 'order.updated' }));
  const validSignature = crypto.createHmac('sha256', secret).update(body).digest('hex');

  const tenant = { _id: 'tenant-1' };
  const integration = { _id: 'integration-1', webhookSecret: secret };

  const adapter = {
    webhookSignatureHeader: 'x-test-signature',
    verifyWebhookSignature: jest.fn(
      (payload: Buffer, signature: string, s: string) =>
        crypto.createHmac('sha256', s).update(payload).digest('hex') === signature,
    ),
  };

  const syncEngine: any = { syncOrders: jest.fn().mockResolvedValue({ imported: 0, skipped: 0, failed: 0 }) };
  const integrationsService: any = {
    getAdapter: jest.fn().mockReturnValue(adapter),
    findByTenantAndPlatform: jest.fn().mockResolvedValue(integration),
  };
  const tenants: any = { findBySlug: jest.fn().mockResolvedValue(tenant) };

  const controller = new IntegrationsWebhookController(syncEngine, integrationsService, tenants);

  function req(rawBody: Buffer) {
    return { rawBody } as any;
  }

  beforeEach(() => jest.clearAllMocks());

  it('rejects when the tenant slug does not resolve', async () => {
    tenants.findBySlug.mockResolvedValueOnce(null);
    await expect(
      controller.handleWebhook('bagy', 'no-such-tenant', { 'x-test-signature': validSignature }, req(body)),
    ).rejects.toThrow(ForbiddenException);
    expect(syncEngine.syncOrders).not.toHaveBeenCalled();
  });

  it('rejects when there is no active integration for that tenant+platform', async () => {
    integrationsService.findByTenantAndPlatform.mockResolvedValueOnce(null);
    await expect(
      controller.handleWebhook('bagy', 'lmfit', { 'x-test-signature': validSignature }, req(body)),
    ).rejects.toThrow(ForbiddenException);
    expect(syncEngine.syncOrders).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature', async () => {
    await expect(
      controller.handleWebhook('bagy', 'lmfit', { 'x-test-signature': 'wrong' }, req(body)),
    ).rejects.toThrow(ForbiddenException);
    expect(syncEngine.syncOrders).not.toHaveBeenCalled();
  });

  it('rejects a missing signature header entirely', async () => {
    await expect(controller.handleWebhook('bagy', 'lmfit', {}, req(body))).rejects.toThrow(ForbiddenException);
    expect(syncEngine.syncOrders).not.toHaveBeenCalled();
  });

  it('accepts a valid signature and dispatches a real order sync', async () => {
    const result = await controller.handleWebhook(
      'bagy',
      'lmfit',
      { 'x-test-signature': validSignature },
      req(body),
    );
    expect(result).toEqual({ received: true });
    expect(syncEngine.syncOrders).toHaveBeenCalledWith('tenant-1', 'integration-1');
  });

  it('accepts (with a warning, not a crash) when the adapter has no real signature verification', async () => {
    integrationsService.getAdapter.mockReturnValueOnce({});
    const result = await controller.handleWebhook('shopify', 'lmfit', {}, req(body));
    expect(result).toEqual({ received: true });
  });
});
