import axios from 'axios';
import { WhatsappMediaService } from './whatsapp-media.service';
import { EncryptionService } from '../common/encryption.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('WhatsappMediaService.downloadAudio', () => {
  const encryption = new EncryptionService({ get: () => 'test-encryption-key-for-whatsapp-media-spec' } as any);
  const config: any = { get: jest.fn().mockReturnValue('v21.0') };
  const service = new WhatsappMediaService(config, encryption);

  beforeEach(() => jest.clearAllMocks());

  it('resolves the media URL then downloads the bytes, using the decrypted access token both times', async () => {
    const tenant: any = { slug: 'kivoni', metaWhatsappAccessToken: encryption.encrypt('real-token') };
    mockedAxios.get
      .mockResolvedValueOnce({ data: { url: 'https://lookaside.fbsbx.com/whatsapp_media/abc' } })
      .mockResolvedValueOnce({ data: new ArrayBuffer(4) });

    const result = await service.downloadAudio(tenant, 'media-123');

    expect(result).toBeInstanceOf(Buffer);
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      1,
      'https://graph.facebook.com/v21.0/media-123',
      { headers: { Authorization: 'Bearer real-token' } },
    );
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      2,
      'https://lookaside.fbsbx.com/whatsapp_media/abc',
      { headers: { Authorization: 'Bearer real-token' }, responseType: 'arraybuffer' },
    );
  });

  it('returns null without throwing when the tenant has no metaWhatsappAccessToken', async () => {
    const tenant: any = { slug: 'kivoni' };

    const result = await service.downloadAudio(tenant, 'media-123');

    expect(result).toBeNull();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('returns null when the Meta media-info response has no url', async () => {
    const tenant: any = { slug: 'kivoni', metaWhatsappAccessToken: encryption.encrypt('t') };
    mockedAxios.get.mockResolvedValueOnce({ data: {} });

    const result = await service.downloadAudio(tenant, 'media-123');

    expect(result).toBeNull();
  });

  it('returns null (not throw) when the Graph API call fails', async () => {
    const tenant: any = { slug: 'kivoni', metaWhatsappAccessToken: encryption.encrypt('t') };
    mockedAxios.get.mockRejectedValue(new Error('network down'));

    const result = await service.downloadAudio(tenant, 'media-123');

    expect(result).toBeNull();
  });
});
