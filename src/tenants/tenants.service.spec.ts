import { Types } from 'mongoose';
import { TenantsService } from './tenants.service';
import { EncryptionService } from '../common/encryption.service';

function chain<T>(value: T) {
  const c: any = { exec: jest.fn().mockResolvedValue(value) };
  c.lean = () => c;
  return c;
}

function testEncryption() {
  return new EncryptionService({ get: () => 'test-encryption-key-for-tenants-spec' } as any);
}

describe('TenantsService — config writes invalidate the public slug cache (Loop 2-4 contract)', () => {
  const tenantId = new Types.ObjectId().toString();
  const slug = 'kivoni';

  const tenantModel: any = { findByIdAndUpdate: jest.fn() };
  const tenantRequestModel: any = {};
  const notifications: any = {};
  const encryption = testEncryption();

  const service = new TenantsService(tenantModel, tenantRequestModel, notifications, encryption);

  beforeEach(() => {
    jest.clearAllMocks();
    tenantModel.findByIdAndUpdate.mockReturnValue(chain({ _id: tenantId, slug }));
    // Popula o cache como se `findBySlug` já tivesse sido chamado antes (visitante navegando).
    (service as any).slugCache.set(slug, { tenant: {}, expiresAt: Date.now() + 60_000 });
  });

  it('updateStorefrontConfig invalidates the cached slug entry', async () => {
    expect((service as any).slugCache.has(slug)).toBe(true);
    await service.updateStorefrontConfig(tenantId, { enabled: false });
    expect((service as any).slugCache.has(slug)).toBe(false);
  });

  it('updateShippingConfig invalidates the cached slug entry', async () => {
    await service.updateShippingConfig(tenantId, { standardFee: 30 });
    expect((service as any).slugCache.has(slug)).toBe(false);
  });

  it('updatePricingDisplay invalidates the cached slug entry', async () => {
    await service.updatePricingDisplay(tenantId, { pixDiscountPercent: 10 });
    expect((service as any).slugCache.has(slug)).toBe(false);
  });

  it('updateStorefrontConfig only sets provided fields', async () => {
    await service.updateStorefrontConfig(tenantId, { themePreset: 'monocromo' });
    expect(tenantModel.findByIdAndUpdate).toHaveBeenCalledWith(
      tenantId,
      { $set: { 'storefront.themePreset': 'monocromo' } },
      { new: true },
    );
  });

  it('updateStorefrontConfig (Loop 4b) sets hero/trust-bar/coupon fields flat', async () => {
    await service.updateStorefrontConfig(tenantId, {
      heroTitle: 'Nova coleção',
      heroSubtitle: 'Peças exclusivas',
      showTrustBar: true,
      couponBannerCode: 'BEMVINDO10',
    });
    expect(tenantModel.findByIdAndUpdate).toHaveBeenCalledWith(
      tenantId,
      {
        $set: {
          'storefront.heroTitle': 'Nova coleção',
          'storefront.heroSubtitle': 'Peças exclusivas',
          'storefront.showTrustBar': true,
          'storefront.couponBannerCode': 'BEMVINDO10',
        },
      },
      { new: true },
    );
  });

  it('updateStorefrontConfig (Loop 4b) sets only the provided nested pages.* fields', async () => {
    await service.updateStorefrontConfig(tenantId, { pages: { quemSomos: 'Somos uma loja de moda.' } });
    expect(tenantModel.findByIdAndUpdate).toHaveBeenCalledWith(
      tenantId,
      { $set: { 'storefront.pages.quemSomos': 'Somos uma loja de moda.' } },
      { new: true },
    );
  });

  it('updateStorefrontConfig (Loop 4b) sets the whole lookbook object at once', async () => {
    const lookbook = { imageUrl: 'https://cdn.example.com/look.jpg', title: 'Look de verão', variantIds: ['v1', 'v2'] };
    await service.updateStorefrontConfig(tenantId, { lookbook });
    expect(tenantModel.findByIdAndUpdate).toHaveBeenCalledWith(
      tenantId,
      { $set: { 'storefront.lookbook': lookbook } },
      { new: true },
    );
  });

  it('updateStorefrontConfig (Loop 4b) invalidates the cached slug entry for the new fields too', async () => {
    await service.updateStorefrontConfig(tenantId, { heroTitle: 'Nova coleção' });
    expect((service as any).slugCache.has(slug)).toBe(false);
  });

  it('updateAnalyticsConfig (Loop 15) invalidates the cached slug entry', async () => {
    await service.updateAnalyticsConfig(tenantId, { metaPixelId: '123456' });
    expect((service as any).slugCache.has(slug)).toBe(false);
  });

  it('updateAnalyticsConfig (Loop 15) only sets the provided fields', async () => {
    await service.updateAnalyticsConfig(tenantId, { metaPixelId: '123456', ga4MeasurementId: 'G-ABC123' });
    expect(tenantModel.findByIdAndUpdate).toHaveBeenCalledWith(
      tenantId,
      { $set: { 'analytics.metaPixelId': '123456', 'analytics.ga4MeasurementId': 'G-ABC123' } },
      { new: true },
    );
  });

  it('updateAnalyticsConfig (Loop 18) encrypts server tokens before saving — never stores them in plaintext', async () => {
    await service.updateAnalyticsConfig(tenantId, { metaConversionsApiToken: 'super-secret-meta-token' });

    const call = tenantModel.findByIdAndUpdate.mock.calls.at(-1);
    const stored = call[1].$set['analytics.metaConversionsApiToken'];
    expect(stored).not.toBe('super-secret-meta-token');
    expect(encryption.isEncrypted(stored)).toBe(true);
    expect(encryption.decrypt(stored)).toBe('super-secret-meta-token');
  });

  it('updateAnalyticsConfig (Loop 18) clears a token via null instead of crashing on encrypt(null)', async () => {
    await expect(
      service.updateAnalyticsConfig(tenantId, { metaConversionsApiToken: null } as any),
    ).resolves.toBeDefined();

    const call = tenantModel.findByIdAndUpdate.mock.calls.at(-1);
    expect(call[1].$set['analytics.metaConversionsApiToken']).toBeNull();
  });

  it('updateAnalyticsConfig (Loop 18) leaves pixel ids (public by nature) as plaintext', async () => {
    await service.updateAnalyticsConfig(tenantId, { metaPixelId: '123456' });

    const call = tenantModel.findByIdAndUpdate.mock.calls.at(-1);
    expect(call[1].$set['analytics.metaPixelId']).toBe('123456');
  });

  it('updateBranding (Loop 11-A) encrypts the Meta WhatsApp credentials before saving', async () => {
    await service.updateBranding(tenantId, {
      metaAppSecret: 'app-secret-plain',
      metaWhatsappVerifyToken: 'verify-token-plain',
      metaWhatsappAccessToken: 'access-token-plain',
    } as any);

    const call = tenantModel.findByIdAndUpdate.mock.calls.at(-1);
    const set = call[1].$set;
    for (const [field, plain] of [
      ['metaAppSecret', 'app-secret-plain'],
      ['metaWhatsappVerifyToken', 'verify-token-plain'],
      ['metaWhatsappAccessToken', 'access-token-plain'],
    ] as const) {
      expect(set[field]).not.toBe(plain);
      expect(encryption.isEncrypted(set[field])).toBe(true);
      expect(encryption.decrypt(set[field])).toBe(plain);
    }
  });

  it('updateBranding (Loop 11-A) leaves metaWhatsappPhoneNumberId (an id, not a secret) as plaintext', async () => {
    await service.updateBranding(tenantId, { metaWhatsappPhoneNumberId: '109876543210987' } as any);

    const call = tenantModel.findByIdAndUpdate.mock.calls.at(-1);
    expect(call[1].$set.metaWhatsappPhoneNumberId).toBe('109876543210987');
  });

  it('updateBranding (Loop 11-A) sets whatsappAiEnabled flat, not nested under storefront', async () => {
    await service.updateBranding(tenantId, { whatsappAiEnabled: true } as any);

    const call = tenantModel.findByIdAndUpdate.mock.calls.at(-1);
    expect(call[1].$set).toEqual({ whatsappAiEnabled: true });
  });
});

describe('TenantsService.getPublicBranding — analytics redaction (Loop 15)', () => {
  const slug = 'kivoni';
  const tenantModel: any = {};
  const tenantRequestModel: any = {};
  const notifications: any = {};
  const service = new TenantsService(tenantModel, tenantRequestModel, notifications, testEncryption());

  it('never leaks the server-side analytics tokens to the public payload', async () => {
    (service as any).slugCache.set(slug, {
      tenant: {
        slug,
        name: 'Kivoni Store',
        branding: {},
        plan: 'enterprise',
        analytics: {
          metaPixelId: 'pixel-123',
          metaConversionsApiToken: 'super-secret-token',
          ga4MeasurementId: 'G-ABC123',
          ga4ApiSecret: 'another-secret',
          tiktokPixelId: 'tiktok-456',
          tiktokAccessToken: 'yet-another-secret',
        },
      },
      expiresAt: Date.now() + 60_000,
    });

    const result = await service.getPublicBranding(slug);

    expect(result.analytics).toEqual({
      metaPixelId: 'pixel-123',
      ga4MeasurementId: 'G-ABC123',
      tiktokPixelId: 'tiktok-456',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('returns undefined pixel ids (not a crash) when the tenant has no analytics config at all', async () => {
    (service as any).slugCache.set(slug, {
      tenant: { slug, name: 'Kivoni Store', branding: {}, plan: 'enterprise' },
      expiresAt: Date.now() + 60_000,
    });

    const result = await service.getPublicBranding(slug);
    expect(result.analytics).toEqual({ metaPixelId: undefined, ga4MeasurementId: undefined, tiktokPixelId: undefined });
  });
});
