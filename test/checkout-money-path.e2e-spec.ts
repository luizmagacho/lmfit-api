import { INestApplication, UnprocessableEntityException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BrlMoneyResponseInterceptor } from '../src/common/money/brl-money-response.interceptor';
import { seedProductWithVariant, seedTenant, type VariantSeed } from './helpers/seed-tenant';

/**
 * Loop 26 — Canário do caminho do dinheiro. Primeiro `.e2e-spec.ts` do repo: sobe o `AppModule`
 * inteiro contra um Mongo em memória (test/globalSetup.js) e dirige as 3 chamadas HTTP públicas do
 * checkout via supertest, SEM MOCK de `ProductsService`/`OrdersService`/models — o ponto é exercitar
 * `getWholesalePricingBatch()` e `resolveLines()` de verdade, contra dados no formato de produção.
 *
 * Regressão que este arquivo prova que não volta: o bug de 12/08/2026 rejeitava toda venda de 1
 * peça no varejo porque `orders.service.spec.ts` só mockava `priceWholesale < priceRetail` — forma
 * que quase não existe na base real, onde a maioria das variantes nunca teve atacado configurado e
 * `getWholesalePricingBatch()` faz `priceWholesale` cair no fallback pra `priceRetail`. Ver a matriz
 * de casos A–E em docs/ecommerce/specs/loop-26-money-path-canary.md.
 */
describe('Checkout público — caminho do dinheiro (Loop 26)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Replica o bootstrap real de src/main.ts que importa pro comportamento testado aqui: sem o
    // ValidationPipe/interceptor, os testes veriam um payload/formatação diferente do que o
    // cliente real recebe (ex.: unitPrice como number cru em vez da string BRL "70,00").
    app.useGlobalInterceptors(new BrlMoneyResponseInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        exceptionFactory: (errors) => {
          const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
          return new UnprocessableEntityException({
            message: messages.length <= 1 ? (messages[0] ?? 'Validation failed') : messages,
          });
        },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Executa os 3 passos do checkout público (create draft → patch → submit) e devolve as 3
   *  respostas — cada caso da matriz decide o que verificar em qual passo. */
  async function runCheckout(
    slug: string,
    variantId: string,
    quantity: number,
  ): Promise<{
    createRes: request.Response;
    patchRes: request.Response;
    submitRes: request.Response;
  }> {
    const http = request(app.getHttpServer());

    const createRes = await http
      .post('/public/order-drafts')
      .set('x-tenant-slug', slug)
      .send({});
    const token = createRes.body.sessionToken;

    const patchRes = await http
      .patch(`/public/order-drafts/${token}`)
      .set('x-tenant-slug', slug)
      .send({
        lines: [{ variantId, quantity }],
        metadata: { customer: { name: 'Cliente E2E', phone: '41999998888' } },
      });

    let submitRes!: request.Response;
    if (patchRes.status === 200) {
      submitRes = await http
        .post(`/public/order-drafts/${token}/submit`)
        .set('x-tenant-slug', slug)
        .send({});
    }

    return { createRes, patchRes, submitRes };
  }

  it('AC1: variante sem atacado configurado (priceWholesale ausente) vende 1 unidade no varejo — a regressão de 12/08', async () => {
    const { slug, tenantId } = await seedTenant(app, 'a');
    const seed: VariantSeed = {
      sku: 'AC1-SEM-ATACADO',
      price: 50,
      // priceWholesale intencionalmente ausente — reproduz o fallback real de
      // getWholesalePricingBatch() (priceWholesale = priceRetail quando não configurado).
      minWholesaleQty: 6,
      quantityOnHand: 10,
    };
    const { variantId } = await seedProductWithVariant(app, tenantId, seed);

    const { patchRes, submitRes } = await runCheckout(slug, variantId, 1);

    expect(patchRes.status).toBe(200);
    expect(submitRes.status).toBe(201);
    expect(submitRes.body.orderId).toBeDefined();
    expect(submitRes.body.draft.lines[0].unitPrice).toBe('50,00');
  });

  // AC2 revisada durante o TEST (13/08/2026) — a versão original do spec esperava 400 aqui,
  // assumindo que o checkout público podia reproduzir o gate "preço de atacado exige quantidade
  // mínima" de orders.service.ts::resolveLines(). Rodando o teste de verdade provou que não pode:
  // esse gate protege contra um unitPrice DIGITADO manualmente (staff/PDV) que sub-cotiza o preço
  // pra escapar do mínimo — já coberto por orders.service.spec.ts. No checkout público, o preço
  // sempre é computado a partir da quantidade real em rebuildLinesFromDto() (order-drafts.service.ts):
  // pedir menos que o mínimo NUNCA produz um unitPrice de atacado pra começar, então o gate do lado
  // do OrdersService não tem como disparar por esse caminho — e não deveria mesmo, porque não é bug
  // nenhum: 1 unidade abaixo do mínimo de atacado é uma compra de varejo legítima. O valor real desta
  // AC é provar isso: ter atacado configurado não pode travar nem sub-cobrar uma compra pequena.
  it('AC2: variante com atacado real configurado, mas pedida abaixo do mínimo, cobra o preço de varejo (não é bloqueada nem sub-cotizada)', async () => {
    const { slug, tenantId } = await seedTenant(app, 'b');
    const seed: VariantSeed = {
      sku: 'AC2-ATACADO-REAL',
      price: 50,
      priceWholesale: 35,
      minWholesaleQty: 6,
      quantityOnHand: 10,
    };
    const { variantId } = await seedProductWithVariant(app, tenantId, seed);

    const { patchRes, submitRes } = await runCheckout(slug, variantId, 1);

    expect(patchRes.status).toBe(200);
    expect(submitRes.status).toBe(201);
    expect(submitRes.body.draft.lines[0].unitPrice).toBe('50,00');
  });

  it('AC3: atinge a quantidade mínima e recebe o preço de atacado', async () => {
    const { slug, tenantId } = await seedTenant(app, 'c');
    const seed: VariantSeed = {
      sku: 'AC3-ATACADO-OK',
      price: 50,
      priceWholesale: 35,
      minWholesaleQty: 6,
      quantityOnHand: 10,
    };
    const { variantId } = await seedProductWithVariant(app, tenantId, seed);

    const { patchRes, submitRes } = await runCheckout(slug, variantId, 6);

    expect(patchRes.status).toBe(200);
    expect(submitRes.status).toBe(201);
    expect(submitRes.body.draft.lines[0].unitPrice).toBe('35,00');
  });

  it('AC4: estoque insuficiente sem backorder não cria pedido órfão', async () => {
    const { slug, tenantId } = await seedTenant(app, 'd');
    const seed: VariantSeed = {
      sku: 'AC4-SEM-ESTOQUE',
      price: 50,
      minWholesaleQty: 6,
      quantityOnHand: 2,
      acceptsBackorder: false,
    };
    const { variantId } = await seedProductWithVariant(app, tenantId, seed);

    const { patchRes, submitRes } = await runCheckout(slug, variantId, 5);

    expect(patchRes.status).toBe(400);
    expect(patchRes.body.message).toMatch(/estoque insuficiente/i);
    // runCheckout só chama o submit quando o patch teve sucesso — confirma explicitamente que
    // nenhum pedido chegou a ser criado nesse caminho.
    expect(submitRes).toBeUndefined();
  });

  it('AC5: backorder permitido vira linha de encomenda (isOrder: true)', async () => {
    const { slug, tenantId } = await seedTenant(app, 'e');
    const seed: VariantSeed = {
      sku: 'AC5-BACKORDER',
      price: 50,
      minWholesaleQty: 6,
      quantityOnHand: 2,
      acceptsBackorder: true,
      backorderMinQty: 1,
    };
    const { variantId } = await seedProductWithVariant(app, tenantId, seed);

    const { patchRes, submitRes } = await runCheckout(slug, variantId, 5);

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.lines[0].isOrder).toBe(true);
    expect(submitRes.status).toBe(201);
    expect(submitRes.body.draft.lines[0].isOrder).toBe(true);
  });
});
