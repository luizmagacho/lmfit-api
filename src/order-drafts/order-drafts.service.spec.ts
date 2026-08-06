import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { PublicPatchDraftDto } from './dto/public-patch-draft.dto';
import { OrderDraftsService } from './order-drafts.service';

function chain<T>(value: T) {
  const c: any = { exec: jest.fn().mockResolvedValue(value) };
  c.lean = () => c;
  return c;
}

/** Doc mongoose fake: applyDraftPatch muta e patch/submit chamam save()/toObject(). */
function draftDoc(overrides: Record<string, unknown> = {}) {
  const doc: any = {
    sessionToken: 'tok',
    status: 'open',
    lines: [],
    save: jest.fn().mockResolvedValue(undefined),
    toObject() {
      return { ...doc };
    },
    ...overrides,
  };
  return doc;
}

describe('OrderDraftsService — public draft stock & pricing rules', () => {
  const tenantId = new Types.ObjectId().toString();
  const variantId = new Types.ObjectId();

  const draftModel: any = { findOne: jest.fn() };
  const variantModel: any = { find: jest.fn() };
  const orders: any = { create: jest.fn() };
  const payments: any = { createPixPayment: jest.fn() };
  const customers: any = { findByWaId: jest.fn(), create: jest.fn() };
  const products: any = { getWholesalePricingBatch: jest.fn() };
  const promotions: any = { validateAndComputeDiscount: jest.fn() };
  const notify: any = {
    sendStaffEmail: jest.fn().mockResolvedValue(undefined),
    logStaffAlert: jest.fn(),
  };
  const config: any = { get: jest.fn().mockReturnValue('') };
  const excel: any = {};
  const tenants: any = { findById: jest.fn().mockResolvedValue({ pricingDisplay: { pixDiscountPercent: 0 } }) };

  const service = new OrderDraftsService(
    draftModel,
    variantModel,
    orders,
    payments,
    customers,
    products,
    promotions,
    notify,
    config,
    excel,
    tenants,
  );

  function setupVariant(v: Record<string, unknown>) {
    variantModel.find.mockReturnValue(chain([{ _id: variantId, sku: 'SKU-1', ...v }]));
  }

  function setupPricing(p: { priceRetail: number; priceWholesale: number; minWholesaleQty: number }) {
    products.getWholesalePricingBatch.mockResolvedValue(new Map([[String(variantId), p]]));
  }

  beforeEach(() => {
    jest.clearAllMocks();
    draftModel.findOne.mockReturnValue(chain(draftDoc()));
    setupPricing({ priceRetail: 100, priceWholesale: 80, minWholesaleQty: 5 });
  });

  it('AC3: computes unit price server-side (retail below wholesale threshold)', async () => {
    setupVariant({ quantityOnHand: 10 });
    const out = await service.patchByToken(tenantId, 'tok', {
      lines: [{ variantId: String(variantId), quantity: 2 }],
    } as any);
    expect(out.lines).toEqual([
      expect.objectContaining({ quantity: 2, unitPrice: 100, isOrder: false }),
    ]);
  });

  it('AC3: applies wholesale price when quantity reaches minWholesaleQty', async () => {
    setupVariant({ quantityOnHand: 10 });
    const out = await service.patchByToken(tenantId, 'tok', {
      lines: [{ variantId: String(variantId), quantity: 5 }],
    } as any);
    expect(out.lines[0]).toEqual(expect.objectContaining({ unitPrice: 80 }));
  });

  it('AC4: rejects quantity above on-hand stock when variant does not accept backorder', async () => {
    setupVariant({ quantityOnHand: 3, acceptsBackorder: false });
    await expect(
      service.patchByToken(tenantId, 'tok', {
        lines: [{ variantId: String(variantId), quantity: 4 }],
      } as any),
    ).rejects.toThrow(/Estoque insuficiente/);
  });

  it('AC4: rejects backorder when tenant plan lacks the production feature', async () => {
    setupVariant({ quantityOnHand: 0, acceptsBackorder: true, backorderMinQty: 1 });
    await expect(
      service.patchByToken(
        tenantId,
        'tok',
        { lines: [{ variantId: String(variantId), quantity: 2 }] } as any,
        [], // sem feature "production"
      ),
    ).rejects.toThrow(/Estoque insuficiente/);
  });

  it('AC4: accepts backorder line (isOrder) when allowed and quantity ≥ min', async () => {
    setupVariant({ quantityOnHand: 0, acceptsBackorder: true, backorderMinQty: 3 });
    const out = await service.patchByToken(
      tenantId,
      'tok',
      { lines: [{ variantId: String(variantId), quantity: 3 }] } as any,
      ['production'],
    );
    expect(out.lines[0]).toEqual(expect.objectContaining({ isOrder: true }));
  });

  it('AC4: rejects backorder below the minimum quantity', async () => {
    setupVariant({ quantityOnHand: 0, acceptsBackorder: true, backorderMinQty: 5 });
    await expect(
      service.patchByToken(
        tenantId,
        'tok',
        { lines: [{ variantId: String(variantId), quantity: 2 }] } as any,
        ['production'],
      ),
    ).rejects.toThrow(/só a partir de 5/);
  });
});

describe('OrderDraftsService — shipping (Loop 3)', () => {
  const tenantId = new Types.ObjectId().toString();

  const draftModel: any = { findOne: jest.fn() };
  const variantModel: any = { find: jest.fn() };
  const orders: any = { create: jest.fn() };
  const payments: any = { createPixPayment: jest.fn() };
  const customers: any = { findByWaId: jest.fn(), create: jest.fn() };
  const products: any = { getWholesalePricingBatch: jest.fn() };
  const promotions: any = { validateAndComputeDiscount: jest.fn() };
  const notify: any = { sendStaffEmail: jest.fn().mockResolvedValue(undefined), logStaffAlert: jest.fn() };
  const config: any = { get: jest.fn().mockReturnValue('') };
  const excel: any = {};
  const tenants: any = { findById: jest.fn() };

  const service = new OrderDraftsService(
    draftModel,
    variantModel,
    orders,
    payments,
    customers,
    products,
    promotions,
    notify,
    config,
    excel,
    tenants,
  );

  // Rascunho já com linhas (subtotal 200 = 2 × 100) — só o método de frete muda a cada teste.
  function draftWithSubtotal(subtotal: number) {
    return draftDoc({
      lines: [{ variantId: new Types.ObjectId(), quantity: 2, unitPrice: subtotal / 2, isOrder: false }],
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    tenants.findById.mockResolvedValue({
      shippingConfig: { pickupLabel: 'Retirada', standardFee: 19.9, expressFee: 39.9, freeAboveTotal: 300 },
    });
  });

  it('AC3: computes standard fee from tenant config — client cannot send its own shippingCost (field does not exist on the DTO)', async () => {
    const doc = draftWithSubtotal(200);
    draftModel.findOne.mockReturnValue(chain(doc));

    // Mesmo que alguém monte o body manualmente com shippingCost, o DTO não tem esse campo —
    // `whitelist: true` no ValidationPipe global descarta antes de chegar aqui; simulamos o
    // efeito chamando o service sem esse campo, como o controller real sempre faria.
    const out = await service.patchByToken(tenantId, 'tok', { shippingMethod: 'standard' } as any);
    expect(out.shippingCost).toBe(19.9);
  });

  it('AC3: computes express fee from tenant config', async () => {
    const doc = draftWithSubtotal(200);
    draftModel.findOne.mockReturnValue(chain(doc));

    const out = await service.patchByToken(tenantId, 'tok', { shippingMethod: 'express' } as any);
    expect(out.shippingCost).toBe(39.9);
  });

  it('AC5: pickup is always free, regardless of subtotal or config', async () => {
    const doc = draftWithSubtotal(1);
    draftModel.findOne.mockReturnValue(chain(doc));

    const out = await service.patchByToken(tenantId, 'tok', { shippingMethod: 'pickup' } as any);
    expect(out.shippingCost).toBe(0);
  });

  it('AC4: charges the flat fee when subtotal is below the free-above threshold (300)', async () => {
    const doc = draftWithSubtotal(299);
    draftModel.findOne.mockReturnValue(chain(doc));

    const out = await service.patchByToken(tenantId, 'tok', { shippingMethod: 'standard' } as any);
    expect(out.shippingCost).toBe(19.9);
  });

  it('AC4: waives standard/express fees once the subtotal reaches the free-above threshold (300)', async () => {
    const doc = draftWithSubtotal(300);
    draftModel.findOne.mockReturnValue(chain(doc));

    const out = await service.patchByToken(tenantId, 'tok', { shippingMethod: 'express' } as any);
    expect(out.shippingCost).toBe(0);
  });

  it('falls back to the default fees when the tenant has no shippingConfig at all', async () => {
    tenants.findById.mockResolvedValue({});
    const doc = draftWithSubtotal(50);
    draftModel.findOne.mockReturnValue(chain(doc));

    const out = await service.patchByToken(tenantId, 'tok', { shippingMethod: 'standard' } as any);
    expect(out.shippingCost).toBe(19.9);
  });
});

describe('PublicPatchDraftDto — shippingMethod is a closed enum (AC7)', () => {
  it('rejects a shippingMethod outside pickup/standard/express', async () => {
    const dto = plainToInstance(PublicPatchDraftDto, { shippingMethod: 'teleport' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'shippingMethod')).toBe(true);
  });

  it('accepts a valid shippingMethod', async () => {
    const dto = plainToInstance(PublicPatchDraftDto, { shippingMethod: 'express' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'shippingMethod')).toBe(false);
  });
});

describe('OrderDraftsService.submitByToken — happy path (pix)', () => {
  const tenantId = new Types.ObjectId().toString();
  const variantId = new Types.ObjectId();
  const orderId = new Types.ObjectId();
  const customerId = new Types.ObjectId();

  const draftModel: any = { findOne: jest.fn() };
  const variantModel: any = { find: jest.fn() };
  const orders: any = { create: jest.fn() };
  const payments: any = { createPixPayment: jest.fn() };
  const customers: any = { findByWaId: jest.fn(), create: jest.fn(), applyStoreCredit: jest.fn() };
  const products: any = { getWholesalePricingBatch: jest.fn() };
  const promotions: any = {};
  const notify: any = {
    sendStaffEmail: jest.fn().mockResolvedValue(undefined),
    logStaffAlert: jest.fn(),
  };
  const config: any = { get: jest.fn().mockReturnValue('') };
  const excel: any = {};
  const tenants: any = { findById: jest.fn().mockResolvedValue({ pricingDisplay: { pixDiscountPercent: 0 } }) };

  const service = new OrderDraftsService(
    draftModel,
    variantModel,
    orders,
    payments,
    customers,
    products,
    promotions,
    notify,
    config,
    excel,
    tenants,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks() não esvazia filas de mockResolvedValueOnce não consumidas (ex.: um teste
    // que pula a chamada a tenants.findById por causa de cupom) — reset explícito evita que sobre
    // pra o próximo teste.
    tenants.findById.mockReset().mockResolvedValue({ pricingDisplay: { pixDiscountPercent: 0 } });
  });

  it('creates order + pix payment from guest metadata and marks draft submitted', async () => {
    const doc = draftDoc({
      waId: '11999998888',
      lines: [{ variantId, quantity: 3, unitPrice: 100, isOrder: false }],
      metadata: { customer: { name: 'Guest', phone: '11999998888' } },
      shippingMethod: 'pickup',
      shippingCost: 0,
    });
    draftModel.findOne.mockReturnValue(chain(doc));
    customers.findByWaId.mockResolvedValue(null);
    customers.create.mockResolvedValue({ _id: customerId });
    orders.create.mockResolvedValue({ _id: orderId, total: 300 });
    payments.createPixPayment.mockResolvedValue({
      _id: new Types.ObjectId(),
      qrCode: 'QR',
      qrCodeImage: undefined,
      expiresAt: new Date(),
    });

    const out = await service.submitByToken(tenantId, 'tok', {
      payment: { method: 'pix' },
    } as any);

    // Cliente guest criado a partir do metadata, pedido no canal online
    expect(customers.create).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ name: 'Guest' }),
    );
    expect(orders.create).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        customerId: String(customerId),
        channel: 'online',
        lines: [expect.objectContaining({ variantId: String(variantId), quantity: 3 })],
      }),
      undefined,
    );
    expect(payments.createPixPayment).toHaveBeenCalledWith(tenantId, String(orderId), 300);
    expect(doc.status).toBe('submitted');
    expect(out.orderId).toBe(String(orderId));
    expect(out.payment).toEqual(expect.objectContaining({ qrCode: 'QR' }));
    expect(notify.logStaffAlert).toHaveBeenCalledWith(
      'order_draft_submitted',
      expect.objectContaining({ orderId: String(orderId) }),
    );
  });

  it('Loop 7: prefers matching an existing customer by e-mail over waId, and never creates a duplicate', async () => {
    const doc = draftDoc({
      waId: '11999998888',
      lines: [{ variantId, quantity: 1, unitPrice: 100, isOrder: false }],
      metadata: { customer: { name: 'Guest', phone: '11999998888', email: 'ana@x.com' } },
    });
    draftModel.findOne.mockReturnValue(chain(doc));
    customers.findByEmail = jest.fn().mockResolvedValue({ _id: customerId });
    orders.create.mockResolvedValue({ _id: orderId, total: 100 });
    payments.createPixPayment.mockResolvedValue({ _id: new Types.ObjectId(), qrCode: 'QR', expiresAt: new Date() });

    await service.submitByToken(tenantId, 'tok', { payment: { method: 'pix' } } as any);

    expect(customers.findByEmail).toHaveBeenCalledWith(tenantId, 'ana@x.com');
    expect(customers.findByWaId).not.toHaveBeenCalled();
    expect(customers.create).not.toHaveBeenCalled();
    expect(orders.create).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ customerId: String(customerId) }),
      undefined,
    );
  });

  it('AC4: applies the tenant Pix discount to line prices before creating the order', async () => {
    const doc = draftDoc({
      waId: '11999998888',
      lines: [{ variantId, quantity: 2, unitPrice: 100, isOrder: false }],
      metadata: { customer: { name: 'Guest', phone: '11999998888' } },
    });
    draftModel.findOne.mockReturnValue(chain(doc));
    customers.findByWaId.mockResolvedValue(null);
    customers.create.mockResolvedValue({ _id: customerId });
    orders.create.mockResolvedValue({ _id: orderId, total: 190 });
    payments.createPixPayment.mockResolvedValue({ _id: new Types.ObjectId(), expiresAt: new Date() });
    tenants.findById.mockResolvedValueOnce({ pricingDisplay: { pixDiscountPercent: 5 } });

    await service.submitByToken(tenantId, 'tok', { payment: { method: 'pix' } } as any);

    // R$100 × (1 - 5%) = R$95 por unidade — mesma fórmula exibida no checkout (usePricingRules).
    expect(orders.create).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ lines: [expect.objectContaining({ unitPrice: 95 })] }),
      undefined,
    );
    // O pagamento é criado sobre o total já calculado pelo servidor a partir das linhas com
    // desconto (order.total), nunca recalculado a partir do preço cheio.
    expect(payments.createPixPayment).toHaveBeenCalledWith(tenantId, String(orderId), 190);
  });

  it('AC4: does not stack the Pix discount on top of a coupon (avoids double-discounting)', async () => {
    const doc = draftDoc({
      waId: '11999998888',
      lines: [{ variantId, quantity: 2, unitPrice: 100, isOrder: false }],
      metadata: { customer: { name: 'Guest', phone: '11999998888' } },
      couponCode: 'PROMO10',
      discountTotal: 20,
    });
    draftModel.findOne.mockReturnValue(chain(doc));
    customers.findByWaId.mockResolvedValue(null);
    customers.create.mockResolvedValue({ _id: customerId });
    orders.create.mockResolvedValue({ _id: orderId, total: 180 });
    payments.createPixPayment.mockResolvedValue({ _id: new Types.ObjectId(), expiresAt: new Date() });
    tenants.findById.mockResolvedValueOnce({ pricingDisplay: { pixDiscountPercent: 5 } });

    await service.submitByToken(tenantId, 'tok', { payment: { method: 'pix' } } as any);

    expect(orders.create).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ lines: [expect.objectContaining({ unitPrice: 100 })] }),
      undefined,
    );
  });

  it('does not touch line prices when the tenant has no Pix discount configured (0%)', async () => {
    const doc = draftDoc({
      waId: '11999998888',
      lines: [{ variantId, quantity: 2, unitPrice: 100, isOrder: false }],
      metadata: { customer: { name: 'Guest', phone: '11999998888' } },
    });
    draftModel.findOne.mockReturnValue(chain(doc));
    customers.findByWaId.mockResolvedValue(null);
    customers.create.mockResolvedValue({ _id: customerId });
    orders.create.mockResolvedValue({ _id: orderId, total: 200 });
    payments.createPixPayment.mockResolvedValue({ _id: new Types.ObjectId(), expiresAt: new Date() });
    tenants.findById.mockResolvedValueOnce({ pricingDisplay: { pixDiscountPercent: 0 } });

    await service.submitByToken(tenantId, 'tok', { payment: { method: 'pix' } } as any);

    expect(orders.create).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ lines: [expect.objectContaining({ unitPrice: 100 })] }),
      undefined,
    );
  });

  it('Loop 9: applies store credit as a final deduction when useStoreCredit is true', async () => {
    const doc = draftDoc({
      waId: '11999998888',
      lines: [{ variantId, quantity: 2, unitPrice: 100, isOrder: false }],
      metadata: { customer: { name: 'Guest', phone: '11999998888' } },
      shippingCost: 0,
      discountTotal: 0,
    });
    draftModel.findOne.mockReturnValue(chain(doc));
    customers.findByWaId.mockResolvedValue(null);
    customers.create.mockResolvedValue({ _id: customerId });
    customers.applyStoreCredit.mockResolvedValue(50);
    orders.create.mockResolvedValue({ _id: orderId, total: 150 });
    payments.createPixPayment.mockResolvedValue({ _id: new Types.ObjectId(), expiresAt: new Date() });

    await service.submitByToken(tenantId, 'tok', {
      payment: { method: 'pix' },
      useStoreCredit: true,
    } as any);

    // Subtotal 200 (sem cupom/desconto Pix) é a base contra a qual o crédito é recalculado e
    // deduzido atomicamente no momento do submit — nunca um valor vindo do body.
    expect(customers.applyStoreCredit).toHaveBeenCalledWith(tenantId, String(customerId), 200);
    expect(orders.create).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ creditApplied: 50 }),
      undefined,
    );
  });

  it('Loop 9 (AC4 guard): never touches store credit when useStoreCredit is not set (guest/default checkout)', async () => {
    const doc = draftDoc({
      waId: '11999998888',
      lines: [{ variantId, quantity: 2, unitPrice: 100, isOrder: false }],
      metadata: { customer: { name: 'Guest', phone: '11999998888' } },
    });
    draftModel.findOne.mockReturnValue(chain(doc));
    customers.findByWaId.mockResolvedValue(null);
    customers.create.mockResolvedValue({ _id: customerId });
    orders.create.mockResolvedValue({ _id: orderId, total: 200 });
    payments.createPixPayment.mockResolvedValue({ _id: new Types.ObjectId(), expiresAt: new Date() });

    await service.submitByToken(tenantId, 'tok', { payment: { method: 'pix' } } as any);

    expect(customers.applyStoreCredit).not.toHaveBeenCalled();
    expect(orders.create).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ creditApplied: 0 }),
      undefined,
    );
  });

  it('Loop 9: store credit is computed on top of the coupon-discounted total, not the raw subtotal', async () => {
    const doc = draftDoc({
      waId: '11999998888',
      lines: [{ variantId, quantity: 2, unitPrice: 100, isOrder: false }],
      metadata: { customer: { name: 'Guest', phone: '11999998888' } },
      couponCode: 'PROMO10',
      discountTotal: 20,
    });
    draftModel.findOne.mockReturnValue(chain(doc));
    customers.findByWaId.mockResolvedValue(null);
    customers.create.mockResolvedValue({ _id: customerId });
    customers.applyStoreCredit.mockResolvedValue(30);
    orders.create.mockResolvedValue({ _id: orderId, total: 150 });
    payments.createPixPayment.mockResolvedValue({ _id: new Types.ObjectId(), expiresAt: new Date() });

    await service.submitByToken(tenantId, 'tok', {
      payment: { method: 'pix' },
      useStoreCredit: true,
    } as any);

    // Subtotal 200 - cupom 20 = 180 é a base para o crédito, nunca os 200 crus.
    expect(customers.applyStoreCredit).toHaveBeenCalledWith(tenantId, String(customerId), 180);
    expect(orders.create).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ creditApplied: 30 }),
      undefined,
    );
  });
});
