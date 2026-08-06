import axios from 'axios';
import { WhatsappSenderService } from './whatsapp-sender.service';
import { EncryptionService } from '../common/encryption.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('WhatsappSenderService.sendText', () => {
  const encryption = new EncryptionService({ get: () => 'test-encryption-key-for-whatsapp-sender-spec' } as any);
  const config: any = { get: jest.fn() };
  const service = new WhatsappSenderService(config, encryption);

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.post.mockResolvedValue({ data: {} });
  });

  it('posts to the Meta Graph API with the decrypted token, correct URL and payload', async () => {
    config.get.mockReturnValue('v21.0');
    const encryptedToken = encryption.encrypt('real-access-token');
    const tenant: any = { slug: 'kivoni', metaWhatsappPhoneNumberId: '109876543210987', metaWhatsappAccessToken: encryptedToken };

    const sent = await service.sendText(tenant, '5511999998888', 'Olá! Temos sim em estoque.');

    expect(sent).toBe(true);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/109876543210987/messages',
      { messaging_product: 'whatsapp', to: '5511999998888', type: 'text', text: { body: 'Olá! Temos sim em estoque.' } },
      { headers: { Authorization: 'Bearer real-access-token', 'Content-Type': 'application/json' } },
    );
  });

  it('decrypts a legacy plaintext token without throwing (Loop 18 no-op contract)', async () => {
    config.get.mockReturnValue('v21.0');
    const tenant: any = { slug: 'kivoni', metaWhatsappPhoneNumberId: '109876543210987', metaWhatsappAccessToken: 'legacy-plaintext-token' };

    await service.sendText(tenant, '5511999998888', 'oi');

    const call = mockedAxios.post.mock.calls.at(-1)!;
    expect((call[2] as any).headers.Authorization).toBe('Bearer legacy-plaintext-token');
  });

  it('falls back to META_GRAPH_API_VERSION default (v21.0) when not configured', async () => {
    config.get.mockReturnValue(undefined);
    const tenant: any = { slug: 'kivoni', metaWhatsappPhoneNumberId: '1', metaWhatsappAccessToken: encryption.encrypt('t') };

    await service.sendText(tenant, '5511999998888', 'oi');

    const call = mockedAxios.post.mock.calls.at(-1)!;
    expect(call[0]).toContain('/v21.0/');
  });

  it('does not send and returns false when the tenant has no metaWhatsappPhoneNumberId', async () => {
    const tenant: any = { slug: 'kivoni', metaWhatsappAccessToken: encryption.encrypt('t') };

    const sent = await service.sendText(tenant, '5511999998888', 'oi');

    expect(sent).toBe(false);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('does not send and returns false when the tenant has no metaWhatsappAccessToken', async () => {
    const tenant: any = { slug: 'kivoni', metaWhatsappPhoneNumberId: '109876543210987' };

    const sent = await service.sendText(tenant, '5511999998888', 'oi');

    expect(sent).toBe(false);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
