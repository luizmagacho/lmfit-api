import { SyncEngineService } from './sync-engine.service';

/**
 * Regression coverage for generalizing token refresh from TikTok-only to also cover Mercado Livre
 * and Shopee (both real OAuth2 platforms whose access tokens expire) — previously
 * `tryRefreshTiktokToken` returned `false` for every other platform, so a Mercado Livre/Shopee
 * integration would silently stop syncing once its token expired, with no retry.
 */
describe('SyncEngineService — tryRefreshToken', () => {
  const syncLogModel: any = { create: jest.fn() };
  const variantModel: any = {};
  const integrationModel: any = { updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }) };
  const integrationsService: any = {};
  const mappingService: any = {};
  const orders: any = {};
  const fiscal: any = {};
  const customers: any = {};
  const tiktokAdapter: any = { refreshAccessToken: jest.fn() };
  const mercadoLivreAdapter: any = { refreshAccessToken: jest.fn() };
  const shopeeAdapter: any = { refreshAccessToken: jest.fn() };

  const service = new SyncEngineService(
    syncLogModel,
    variantModel,
    integrationModel,
    integrationsService,
    mappingService,
    orders,
    fiscal,
    customers,
    tiktokAdapter,
    mercadoLivreAdapter,
    shopeeAdapter,
  );

  function integration(overrides: Record<string, unknown> = {}) {
    return {
      _id: 'integration-1',
      platform: 'tiktok',
      credentials: { applicationKey: 'app', apiKey: 'secret', refreshToken: 'rt-1' },
      ...overrides,
    } as any;
  }

  const tryRefreshToken = (i: any, err: any) => (service as any).tryRefreshToken(i, err);

  beforeEach(() => jest.clearAllMocks());

  it('refreshes a tiktok integration and persists the new tokens', async () => {
    tiktokAdapter.refreshAccessToken.mockResolvedValue({ ok: true, accessToken: 'new-at', refreshToken: 'new-rt' });
    const doc = integration({ platform: 'tiktok' });

    const result = await tryRefreshToken(doc, new Error('token expired'));

    expect(result).toBe(true);
    expect(tiktokAdapter.refreshAccessToken).toHaveBeenCalledWith('app', 'secret', 'rt-1');
    expect(integrationModel.updateOne).toHaveBeenCalledWith(
      { _id: 'integration-1' },
      { $set: { 'credentials.accessToken': 'new-at', 'credentials.refreshToken': 'new-rt' } },
    );
    expect(doc.credentials.accessToken).toBe('new-at');
  });

  it('refreshes a mercadolivre integration via MercadoLivreAdapter', async () => {
    mercadoLivreAdapter.refreshAccessToken.mockResolvedValue({ ok: true, accessToken: 'ml-at', refreshToken: 'ml-rt' });
    const doc = integration({ platform: 'mercadolivre' });

    const result = await tryRefreshToken(doc, new Error('401'));

    expect(result).toBe(true);
    expect(mercadoLivreAdapter.refreshAccessToken).toHaveBeenCalledWith('app', 'secret', 'rt-1');
  });

  it('refreshes a shopee integration via ShopeeAdapter, passing storeId', async () => {
    shopeeAdapter.refreshAccessToken.mockResolvedValue({ ok: true, accessToken: 'shopee-at' });
    const doc = integration({ platform: 'shopee', credentials: { applicationKey: 'app', apiKey: 'secret', refreshToken: 'rt-1', storeId: 'shop-9' } });

    const result = await tryRefreshToken(doc, new Error('401'));

    expect(result).toBe(true);
    expect(shopeeAdapter.refreshAccessToken).toHaveBeenCalledWith('app', 'secret', 'rt-1', 'shop-9');
  });

  it('does not attempt a shopee refresh when storeId is missing', async () => {
    const doc = integration({ platform: 'shopee', credentials: { applicationKey: 'app', apiKey: 'secret', refreshToken: 'rt-1' } });

    const result = await tryRefreshToken(doc, new Error('401'));

    expect(result).toBe(false);
    expect(shopeeAdapter.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('returns false without calling any adapter for a platform with no refresh support (e.g. bagy)', async () => {
    const doc = integration({ platform: 'bagy' });

    const result = await tryRefreshToken(doc, new Error('401'));

    expect(result).toBe(false);
    expect(tiktokAdapter.refreshAccessToken).not.toHaveBeenCalled();
    expect(mercadoLivreAdapter.refreshAccessToken).not.toHaveBeenCalled();
    expect(shopeeAdapter.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('returns false and does not persist anything when the refresh call itself fails', async () => {
    tiktokAdapter.refreshAccessToken.mockResolvedValue({ ok: false, error: 'refresh_token expirado' });
    const doc = integration({ platform: 'tiktok' });

    const result = await tryRefreshToken(doc, new Error('401'));

    expect(result).toBe(false);
    expect(integrationModel.updateOne).not.toHaveBeenCalled();
  });

  it('returns false immediately when credentials are incomplete', async () => {
    const doc = integration({ platform: 'tiktok', credentials: { applicationKey: 'app' } });

    const result = await tryRefreshToken(doc, new Error('401'));

    expect(result).toBe(false);
    expect(tiktokAdapter.refreshAccessToken).not.toHaveBeenCalled();
  });
});
