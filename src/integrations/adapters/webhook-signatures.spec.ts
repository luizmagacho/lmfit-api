import * as crypto from 'crypto';
import { BagyAdapter } from './bagy.adapter';
import { NuvemshopAdapter } from './nuvemshop.adapter';
import { MercadoLivreAdapter } from './mercadolivre.adapter';
import { ShopeeAdapter } from './shopee.adapter';
import { TiktokAdapter } from './tiktok.adapter';

const secret = 'super-secret';
const body = Buffer.from(JSON.stringify({ event: 'order.updated', id: '123' }));

describe('adapter webhookSignatureHeader', () => {
  it('every real (non-stub) adapter declares which header carries its signature', () => {
    expect(new BagyAdapter().webhookSignatureHeader).toBeTruthy();
    expect(new NuvemshopAdapter().webhookSignatureHeader).toBeTruthy();
    expect(new MercadoLivreAdapter().webhookSignatureHeader).toBeTruthy();
    expect(new ShopeeAdapter().webhookSignatureHeader).toBeTruthy();
    expect(new TiktokAdapter().webhookSignatureHeader).toBeTruthy();
  });
});

describe('BagyAdapter.verifyWebhookSignature', () => {
  const adapter = new BagyAdapter();

  it('accepts a correctly-computed HMAC-SHA256 hex digest', () => {
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(adapter.verifyWebhookSignature(body, signature, secret)).toBe(true);
  });

  it('rejects a wrong signature', () => {
    const wrong = crypto.createHmac('sha256', 'wrong-secret').update(body).digest('hex');
    expect(adapter.verifyWebhookSignature(body, wrong, secret)).toBe(false);
  });
});

describe('NuvemshopAdapter.verifyWebhookSignature', () => {
  const adapter = new NuvemshopAdapter();

  it('accepts a correctly-computed HMAC-SHA256 hex digest', () => {
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(adapter.verifyWebhookSignature(body, signature, secret)).toBe(true);
  });

  it('rejects a wrong signature', () => {
    expect(adapter.verifyWebhookSignature(body, 'deadbeef', secret)).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(adapter.verifyWebhookSignature(body, '', secret)).toBe(false);
  });
});

describe('TiktokAdapter.verifyWebhookSignature', () => {
  const adapter = new TiktokAdapter();

  it('accepts a correctly-computed HMAC-SHA256 hex digest of the raw body', () => {
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(adapter.verifyWebhookSignature(body, signature, secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const tampered = Buffer.from(JSON.stringify({ event: 'order.updated', id: '999' }));
    expect(adapter.verifyWebhookSignature(tampered, signature, secret)).toBe(false);
  });

  it('never throws on a malformed/wrong-length signature header', () => {
    expect(() => adapter.verifyWebhookSignature(body, 'too-short', secret)).not.toThrow();
    expect(adapter.verifyWebhookSignature(body, 'too-short', secret)).toBe(false);
  });
});

describe('ShopeeAdapter.verifyWebhookSignature', () => {
  const adapter = new ShopeeAdapter();
  const callbackUrl = 'https://kivoni.com.br/webhooks/ecommerce/shopee/lmfit';

  it('accepts a correctly-computed HMAC over callbackUrl|body', () => {
    const signature = crypto.createHmac('sha256', secret).update(`${callbackUrl}|${body.toString('utf8')}`).digest('hex');
    expect(adapter.verifyWebhookSignature(body, signature, secret, callbackUrl)).toBe(true);
  });

  it('rejects when the callback URL used to sign differs', () => {
    const signature = crypto.createHmac('sha256', secret).update(`${callbackUrl}|${body.toString('utf8')}`).digest('hex');
    expect(adapter.verifyWebhookSignature(body, signature, secret, 'https://other.example/webhook')).toBe(false);
  });
});

describe('MercadoLivreAdapter.verifyWebhookSignature', () => {
  const adapter = new MercadoLivreAdapter();
  const resourceId = 'order-123';
  const requestId = 'req-abc';

  function buildHeader(ts: string) {
    const manifest = `id:${resourceId};request-id:${requestId};ts:${ts};`;
    const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    return `ts=${ts},v1=${v1}`;
  }

  it('accepts a correctly-computed manifest HMAC', () => {
    const header = buildHeader('1700000000');
    expect(adapter.verifyWebhookSignature(body, header, secret, resourceId, requestId)).toBe(true);
  });

  it('rejects when the resourceId used to verify differs from the one signed', () => {
    const header = buildHeader('1700000000');
    expect(adapter.verifyWebhookSignature(body, header, secret, 'different-resource', requestId)).toBe(false);
  });

  it('rejects a header missing the v1 part', () => {
    expect(adapter.verifyWebhookSignature(body, 'ts=1700000000', secret, resourceId, requestId)).toBe(false);
  });
});
