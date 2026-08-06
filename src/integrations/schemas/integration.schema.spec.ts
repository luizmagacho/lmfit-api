import * as mongoose from 'mongoose';
import { Types } from 'mongoose';
import { Integration, IntegrationSchema, IntegrationPlatform } from './integration.schema';

/**
 * Regression test for the tiktok-enum bug: the Mongoose schema's `enum` list had drifted from the
 * TS `IntegrationPlatform` union (missing `'tiktok'`), so `IntegrationsService.connectTiktok()`
 * always failed at `.create()` with a `ValidationError` — after the merchant had already
 * authorized the app on TikTok's side. This validates every platform the TS type declares as
 * supported actually passes real Mongoose validation, not a mocked model.
 */
describe('Integration schema', () => {
  const modelName = `IntegrationSchemaSpec_${Date.now()}`;
  const IntegrationModel = mongoose.model(modelName, IntegrationSchema);

  const allPlatforms: IntegrationPlatform[] = [
    'bagy',
    'nuvemshop',
    'tray',
    'loja_integrada',
    'shopify',
    'mercadolivre',
    'shopee',
    'tiktok',
  ];

  it.each(allPlatforms)('accepts platform "%s" declared by the IntegrationPlatform type', (platform) => {
    const doc = new IntegrationModel({
      tenantId: new Types.ObjectId(),
      platform,
      label: 'Loja de teste',
      credentials: { accessToken: 'token' },
    });
    const err = doc.validateSync();
    expect(err).toBeUndefined();
  });

  it('rejects a platform not in the enum', () => {
    const doc = new IntegrationModel({
      tenantId: new Types.ObjectId(),
      platform: 'not-a-real-platform',
      label: 'Loja de teste',
      credentials: { accessToken: 'token' },
    });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err?.errors?.platform).toBeDefined();
  });
});
