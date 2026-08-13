import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ShippingQuoteService } from './shipping-quote.service';

function chain<T>(value: T) {
  const c: any = { exec: jest.fn().mockResolvedValue(value) };
  c.lean = () => c;
  return c;
}

describe('ShippingQuoteService.quote (Loop 27)', () => {
  const tenantId = new Types.ObjectId().toString();
  const variantId = new Types.ObjectId().toString();
  const productId = new Types.ObjectId();

  const variantModel: any = { find: jest.fn() };
  const productModel: any = { find: jest.fn() };
  const tenants: any = { findById: jest.fn() };
  const encryption: any = { decrypt: jest.fn((v: string) => v) };
  const melhorEnvio: any = { calculate: jest.fn() };

  const service = new ShippingQuoteService(variantModel, productModel, tenants, encryption, melhorEnvio);

  const dimensionedProduct = {
    _id: productId,
    widthCm: 30,
    heightCm: 5,
    lengthCm: 25,
    weightGrams: 600,
  };
  const bareProduct = { _id: productId }; // sem dimensões

  const variant = { _id: variantId, productId };

  const lines = [{ variantId, quantity: 2 }];

  beforeEach(() => {
    jest.clearAllMocks();
    variantModel.find.mockReturnValue(chain([variant]));
  });

  it('AC5: rejeita CEP inválido antes de qualquer chamada externa', async () => {
    await expect(service.quote(tenantId, '123', lines)).rejects.toBeInstanceOf(BadRequestException);
    expect(tenants.findById).not.toHaveBeenCalled();
  });

  it('AC1: sem token configurado, devolve o fallback fixo idêntico ao de hoje', async () => {
    tenants.findById.mockResolvedValue({
      shippingConfig: { pickupLabel: 'Retirada', standardFee: 19.9, expressFee: 39.9 },
    });

    const options = await service.quote(tenantId, '80010000', lines);

    expect(options).toEqual([
      { method: 'pickup', label: 'Retirada', price: 0, isPickup: true },
      { method: 'standard', label: 'Entrega padrão', price: 19.9 },
      { method: 'express', label: 'Entrega expressa', price: 39.9 },
    ]);
    expect(melhorEnvio.calculate).not.toHaveBeenCalled();
  });

  it('AC2: com token configurado e produtos dimensionados, cota via adapter e mapeia a resposta', async () => {
    tenants.findById.mockResolvedValue({
      shippingConfig: {
        pickupLabel: 'Retirada',
        originAddress: { cep: '01310930' },
        melhorEnvio: { token: 'enc:v1:fake', ambiente: 'sandbox' },
      },
    });
    productModel.find.mockReturnValue(chain([dimensionedProduct]));
    melhorEnvio.calculate.mockResolvedValue({
      ok: true,
      options: [
        { serviceId: 1, carrierName: 'Correios', serviceName: 'PAC', price: 37.79, deliveryDays: 9 },
      ],
    });

    const options = await service.quote(tenantId, '80010000', lines);

    expect(melhorEnvio.calculate).toHaveBeenCalledWith(
      { token: 'enc:v1:fake', ambiente: 'sandbox' },
      { postalCode: '01310930' },
      { postalCode: '80010000' },
      [{ id: variantId, widthCm: 30, heightCm: 5, lengthCm: 25, weightKg: 0.6, quantity: 2 }],
    );
    expect(options).toEqual([
      { method: 'pickup', label: 'Retirada', price: 0, isPickup: true },
      { method: 'me:1', label: 'PAC (Correios)', price: 37.79, deliveryDays: 9 },
    ]);
  });

  it('AC3: produto sem dimensão cadastrada cai no fallback, mesmo com token configurado', async () => {
    tenants.findById.mockResolvedValue({
      shippingConfig: {
        originAddress: { cep: '01310930' },
        melhorEnvio: { token: 'enc:v1:fake', ambiente: 'sandbox' },
        standardFee: 19.9,
        expressFee: 39.9,
      },
    });
    productModel.find.mockReturnValue(chain([bareProduct]));

    const options = await service.quote(tenantId, '80010000', lines);

    expect(melhorEnvio.calculate).not.toHaveBeenCalled();
    expect(options.map((o: any) => o.method)).toEqual(['pickup', 'standard', 'express']);
  });

  it('AC4: falha da API da Melhor Envio cai no fallback em vez de quebrar o checkout', async () => {
    tenants.findById.mockResolvedValue({
      shippingConfig: {
        originAddress: { cep: '01310930' },
        melhorEnvio: { token: 'enc:v1:fake', ambiente: 'sandbox' },
        standardFee: 19.9,
        expressFee: 39.9,
      },
    });
    productModel.find.mockReturnValue(chain([dimensionedProduct]));
    melhorEnvio.calculate.mockResolvedValue({ ok: false, error: 'timeout' });

    const options = await service.quote(tenantId, '80010000', lines);

    expect(options.map((o: any) => o.method)).toEqual(['pickup', 'standard', 'express']);
  });

  it('AC4b: lista de opções reais vazia (todas indisponíveis) também cai no fallback', async () => {
    tenants.findById.mockResolvedValue({
      shippingConfig: {
        originAddress: { cep: '01310930' },
        melhorEnvio: { token: 'enc:v1:fake', ambiente: 'sandbox' },
      },
    });
    productModel.find.mockReturnValue(chain([dimensionedProduct]));
    melhorEnvio.calculate.mockResolvedValue({ ok: true, options: [] });

    const options = await service.quote(tenantId, '80010000', lines);

    expect(options.map((o: any) => o.method)).toEqual(['pickup', 'standard', 'express']);
  });

  it('sem endereço de origem configurado, cai no fallback mesmo com token presente', async () => {
    tenants.findById.mockResolvedValue({
      shippingConfig: { melhorEnvio: { token: 'enc:v1:fake', ambiente: 'sandbox' } },
    });

    const options = await service.quote(tenantId, '80010000', lines);

    expect(melhorEnvio.calculate).not.toHaveBeenCalled();
    expect(options.map((o: any) => o.method)).toEqual(['pickup', 'standard', 'express']);
  });

  it('descriptografia do token falhando cai no fallback em vez de lançar', async () => {
    tenants.findById.mockResolvedValue({
      shippingConfig: {
        originAddress: { cep: '01310930' },
        melhorEnvio: { token: 'enc:v1:corrompido', ambiente: 'sandbox' },
      },
    });
    encryption.decrypt.mockImplementationOnce(() => {
      throw new Error('malformed');
    });

    const options = await service.quote(tenantId, '80010000', lines);

    expect(melhorEnvio.calculate).not.toHaveBeenCalled();
    expect(options.map((o: any) => o.method)).toEqual(['pickup', 'standard', 'express']);
  });
});
