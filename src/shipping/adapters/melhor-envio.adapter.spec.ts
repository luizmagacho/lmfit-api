import axios from 'axios';
import { MelhorEnvioAdapter } from './melhor-envio.adapter';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('MelhorEnvioAdapter.calculate', () => {
  const adapter = new MelhorEnvioAdapter();
  const creds = { token: 'plain-token', ambiente: 'sandbox' as const };
  const from = { postalCode: '01310930' };
  const to = { postalCode: '80010000' };
  const packages = [{ id: 'v1', widthCm: 30, heightCm: 5, lengthCm: 25, weightKg: 0.6, quantity: 2 }];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('monta a URL por ambiente (sandbox) e o payload no formato oficial da Melhor Envio', async () => {
    mockedAxios.post.mockResolvedValue({ data: [] });

    await adapter.calculate(creds, from, to, packages);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate',
      {
        from: { postal_code: '01310930' },
        to: { postal_code: '80010000' },
        products: [{ id: 'v1', width: 30, height: 5, length: 25, weight: 0.6, quantity: 2 }],
      },
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer plain-token',
          Accept: 'application/json',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('usa a URL de produção quando ambiente = producao', async () => {
    mockedAxios.post.mockResolvedValue({ data: [] });

    await adapter.calculate({ ...creds, ambiente: 'producao' }, from, to, packages);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://melhorenvio.com.br/api/v2/me/shipment/calculate',
      expect.anything(),
      expect.anything(),
    );
  });

  it('mapeia a resposta real (preço string → number, delivery_time → deliveryDays)', async () => {
    mockedAxios.post.mockResolvedValue({
      data: [
        {
          id: 1,
          name: 'PAC',
          price: '37.79',
          delivery_time: 9,
          company: { id: 1, name: 'Correios' },
        },
      ],
    });

    const result = await adapter.calculate(creds, from, to, packages);

    expect(result).toEqual({
      ok: true,
      options: [{ serviceId: 1, carrierName: 'Correios', serviceName: 'PAC', price: 37.79, deliveryDays: 9 }],
    });
  });

  it('descarta itens de erro misturados na mesma lista de resposta (serviço indisponível)', async () => {
    mockedAxios.post.mockResolvedValue({
      data: [
        { id: 1, name: 'PAC', price: '37.79', delivery_time: 9, company: { id: 1, name: 'Correios' } },
        { id: 2, name: 'SEDEX', error: 'Serviço indisponível para as dimensões informadas' },
      ],
    });

    const result = await adapter.calculate(creds, from, to, packages);

    expect(result).toEqual({
      ok: true,
      options: [{ serviceId: 1, carrierName: 'Correios', serviceName: 'PAC', price: 37.79, deliveryDays: 9 }],
    });
  });

  it('nunca propaga o erro cru — devolve {ok:false, error} em timeout/4xx/5xx', async () => {
    mockedAxios.post.mockRejectedValue({ message: 'timeout of 8000ms exceeded' });

    const result = await adapter.calculate(creds, from, to, packages);

    expect(result).toEqual({ ok: false, error: 'timeout of 8000ms exceeded' });
  });

  it('usa a mensagem de erro da API quando disponível (error.response.data.message)', async () => {
    mockedAxios.post.mockRejectedValue({
      message: 'Request failed with status code 422',
      response: { data: { message: 'O campo from.postal_code é obrigatório.' } },
    });

    const result = await adapter.calculate(creds, from, to, packages);

    expect(result).toEqual({ ok: false, error: 'O campo from.postal_code é obrigatório.' });
  });
});
