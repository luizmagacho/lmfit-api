import axios from 'axios';
import { AnalyticsService } from './analytics.service';
import { EncryptionService } from '../common/encryption.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AnalyticsService.trackPurchase', () => {
  const tenantId = 'tenant-1';
  const tenants: any = { findById: jest.fn() };
  const encryption = new EncryptionService({ get: () => 'test-encryption-key-for-analytics-spec' } as any);
  const service = new AnalyticsService(tenants, encryption);

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.post.mockResolvedValue({ data: {} });
  });

  it('does nothing when the tenant has no analytics config at all', async () => {
    tenants.findById.mockResolvedValue({});

    await service.trackPurchase(tenantId, { orderId: 'order-1', amount: 100 });

    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('does nothing when the tenant lookup itself fails (e.g. bad tenantId)', async () => {
    tenants.findById.mockRejectedValue(new Error('not found'));

    await expect(service.trackPurchase(tenantId, { orderId: 'order-1', amount: 100 })).resolves.toBeUndefined();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('only fires the providers that have BOTH a pixel id and a server token configured', async () => {
    tenants.findById.mockResolvedValue({
      analytics: {
        metaPixelId: 'pixel-only-no-token',
        ga4MeasurementId: 'G-ABC',
        ga4ApiSecret: 'secret',
        // tiktok: nothing configured
      },
    });

    await service.trackPurchase(tenantId, { orderId: 'order-1', amount: 100 });

    // Meta: pixel id present but no token → must NOT fire.
    expect(mockedAxios.post).not.toHaveBeenCalledWith(expect.stringContaining('graph.facebook.com'), expect.anything(), expect.anything());
    // GA4: both present → must fire.
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://www.google-analytics.com/mp/collect',
      expect.objectContaining({ events: [expect.objectContaining({ name: 'purchase' })] }),
      expect.objectContaining({ params: { measurement_id: 'G-ABC', api_secret: 'secret' } }),
    );
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('fires all three providers with the correct payload shape when fully configured', async () => {
    tenants.findById.mockResolvedValue({
      analytics: {
        metaPixelId: 'meta-pixel',
        metaConversionsApiToken: 'meta-token',
        ga4MeasurementId: 'G-ABC',
        ga4ApiSecret: 'ga4-secret',
        tiktokPixelId: 'tiktok-pixel',
        tiktokAccessToken: 'tiktok-token',
      },
    });

    await service.trackPurchase(tenantId, { orderId: 'order-42', amount: 250.5 });

    expect(mockedAxios.post).toHaveBeenCalledTimes(3);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v19.0/meta-pixel/events',
      expect.objectContaining({
        data: [
          expect.objectContaining({
            event_name: 'Purchase',
            custom_data: expect.objectContaining({ value: 250.5, currency: 'BRL', order_id: 'order-42' }),
          }),
        ],
      }),
      expect.objectContaining({ params: { access_token: 'meta-token' } }),
    );

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://business-api.tiktok.com/open_api/v1.3/event/track/',
      expect.objectContaining({
        event_source_id: 'tiktok-pixel',
        data: [expect.objectContaining({ event: 'CompletePayment' })],
      }),
      expect.objectContaining({ headers: expect.objectContaining({ 'Access-Token': 'tiktok-token' }) }),
    );
  });

  it('decrypts real encrypted tokens (Loop 18) before using them, so the API call gets the real plaintext token, never the ciphertext', async () => {
    tenants.findById.mockResolvedValue({
      analytics: {
        metaPixelId: 'meta-pixel',
        metaConversionsApiToken: encryption.encrypt('real-meta-token'),
        ga4MeasurementId: 'G-ABC',
        ga4ApiSecret: encryption.encrypt('real-ga4-secret'),
      },
    });

    await service.trackPurchase(tenantId, { orderId: 'order-1', amount: 100 });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('graph.facebook.com'),
      expect.anything(),
      expect.objectContaining({ params: { access_token: 'real-meta-token' } }),
    );
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://www.google-analytics.com/mp/collect',
      expect.anything(),
      expect.objectContaining({ params: { measurement_id: 'G-ABC', api_secret: 'real-ga4-secret' } }),
    );
  });

  it('never throws when a provider call fails — each provider fails independently', async () => {
    tenants.findById.mockResolvedValue({
      analytics: {
        metaPixelId: 'meta-pixel',
        metaConversionsApiToken: 'meta-token',
        ga4MeasurementId: 'G-ABC',
        ga4ApiSecret: 'ga4-secret',
      },
    });
    mockedAxios.post.mockRejectedValue(new Error('network down'));

    await expect(service.trackPurchase(tenantId, { orderId: 'order-1', amount: 100 })).resolves.toBeUndefined();
  });
});
