#!/usr/bin/env node
/**
 * Health check de todos os endpoints GET da API (+ fluxos de escrita opcionais).
 *
 * Uso:
 *   node scripts/health-check.js                          # local, só leituras
 *   BASE_URL=https://api.kivoni.com.br node scripts/health-check.js
 *   node scripts/health-check.js --write                  # inclui fluxo de escrita (NUNCA em prod)
 *   node scripts/health-check.js --json                   # saída JSON para CI
 *
 * Env:
 *   BASE_URL      (default http://127.0.0.1:4000)
 *   TENANT_SLUG   (default kivoni)
 *   HC_EMAIL      (default admin@kivoni.local)
 *   HC_PASSWORD   (default ChangeMe123!)
 */

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const TENANT_SLUG = process.env.TENANT_SLUG || 'kivoni';
const HC_EMAIL = process.env.HC_EMAIL || 'admin@kivoni.local';
const HC_PASSWORD = process.env.HC_PASSWORD || 'ChangeMe123!';
const WRITE = process.argv.includes('--write');
const AS_JSON = process.argv.includes('--json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const now = new Date();
const from = new Date(now.getTime() - 30 * 86400000).toISOString();
const to = now.toISOString();

/** [método, rota, opções] — rotas com :id são resolvidas dinamicamente quando possível. */
const PUBLIC_GETS = [
  ['GET', '/health'],
  ['GET', '/public/tenants'],
  ['GET', `/public/tenants/${TENANT_SLUG}`],
  ['GET', '/public/catalog/categories'],
  ['GET', '/public/catalog/products'],
];

const AUTH_GETS = [
  ['GET', '/auth/me'],
  ['GET', '/users?page=1&limit=5'],
  ['GET', '/tenants'],
  ['GET', '/billing/my-plan'],
  ['GET', '/customers?page=1&limit=5'],
  ['GET', '/suppliers?page=1&limit=5'],
  ['GET', '/products?page=1&limit=5'],
  ['GET', '/materials?page=1&limit=5'],
  ['GET', '/purchases?page=1&limit=5'],
  ['GET', '/invoices?page=1&limit=5'],
  ['GET', '/invoices/status-options'],
  ['GET', '/orders?page=1&limit=5'],
  ['GET', '/order-drafts?page=1&limit=5'],
  ['GET', '/payments?page=1&limit=5'],
  ['GET', '/cashflow?page=1&limit=5'],
  ['GET', '/cashflow/summary'],
  ['GET', '/cashflow/batches'],
  ['GET', '/production/batches?page=1&limit=5'],
  ['GET', '/production/batches/kanban'],
  ['GET', '/production/batches/statuses'],
  ['GET', '/production/cmv-summary'],
  ['GET', '/integrations'],
  ['GET', `/reports/summary?from=${from}&to=${to}`],
  ['GET', '/reports/sales-today'],
  ['GET', `/reports/abc?from=${from}&to=${to}`],
  ['GET', `/reports/sales-and-purchases-daily?from=${from}&to=${to}`],
  ['GET', `/reports/purchases-daily?from=${from}&to=${to}`],
  ['GET', `/reports/revenue-by-product?from=${from}&to=${to}`],
  ['GET', `/reports/dre?from=${from}&to=${to}&taxRate=6`],
  ['GET', '/internal/whatsapp/messages?page=1&limit=5'],
  ['GET', '/internal/whatsapp/escalations?page=1&limit=5'],
];

const results = [];

async function hit(method, path, { token, body, okStatuses } = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'x-tenant-slug': TENANT_SLUG };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const started = Date.now();
  let status = 0;
  let error = null;
  let data = null;
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    status = res.status;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } catch (e) {
    error = e.message;
  }
  const ms = Date.now() - started;
  const allowed = okStatuses || [200, 201];
  const ok = allowed.includes(status);
  results.push({ method, path, status, ms, ok, error });
  if (!AS_JSON) {
    const flag = ok ? '✓' : '✗';
    const line = `${flag} ${method.padEnd(6)} ${path.padEnd(60)} ${String(status).padStart(3)}  ${String(ms).padStart(5)}ms${error ? `  ${error}` : ''}`;
    console.log(line);
    if (status === 429) console.log('  ⚠ rate limit (429) — aumente o intervalo entre chamadas');
  }
  await sleep(60);
  return { status, data, ok };
}

async function main() {
  if (!AS_JSON) {
    console.log(`\nHealth check — ${BASE_URL} (tenant: ${TENANT_SLUG})${WRITE ? ' [COM ESCRITA]' : ' [somente leitura]'}\n`);
  }

  // 1. Públicos
  for (const [m, p] of PUBLIC_GETS) await hit(m, p);

  // 2. Login
  const login = await hit('POST', '/auth/login', {
    body: { email: HC_EMAIL, password: HC_PASSWORD },
  });
  const token = login.data?.accessToken;
  if (!token) {
    if (!AS_JSON) console.error('\n✗ Login falhou — abortando checks autenticados.');
    finish();
    return;
  }

  // 3. GETs autenticados
  for (const [m, p] of AUTH_GETS) await hit(m, p, { token });

  // 4. Detalhe dinâmico: pega o primeiro id de orders/products/customers e testa /:id
  for (const base of ['orders', 'products', 'customers', 'purchases']) {
    const found = results.find((r) => r.path.startsWith(`/${base}?`) && r.ok);
    if (!found) continue;
    const list = await fetch(`${BASE_URL}/${base}?page=1&limit=1`, {
      headers: { Authorization: `Bearer ${token}`, 'x-tenant-slug': TENANT_SLUG },
    }).then((r) => r.json()).catch(() => null);
    const first = list?.items?.[0] ?? (Array.isArray(list) ? list[0] : null);
    const id = first?._id ?? first?.id;
    if (id) await hit('GET', `/${base}/${id}`, { token });
  }

  // 5. Fluxo de escrita (opcional, nunca em prod)
  if (WRITE) {
    const created = await hit('POST', '/customers', {
      token,
      body: { name: `HC Teste ${Date.now()}` },
    });
    const cid = created.data?._id ?? created.data?.id;
    if (cid) {
      await hit('PATCH', `/customers/${cid}`, { token, body: { notes: 'health-check' } });
      await hit('DELETE', `/customers/${cid}`, { token });
    }
  }

  finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  const avg = Math.round(results.reduce((s, r) => s + r.ms, 0) / Math.max(1, results.length));
  const slow = [...results].sort((a, b) => b.ms - a.ms).slice(0, 3);
  if (AS_JSON) {
    console.log(JSON.stringify({ baseUrl: BASE_URL, total: results.length, failed: failed.length, avgMs: avg, results }, null, 2));
  } else {
    console.log(`\n${results.length} chamadas · ${failed.length} falha(s) · latência média ${avg}ms`);
    console.log(`Mais lentas: ${slow.map((r) => `${r.path} (${r.ms}ms)`).join(' · ')}`);
    if (failed.length) {
      console.log('\nFalhas:');
      for (const f of failed) console.log(`  ${f.method} ${f.path} → ${f.status}${f.error ? ` (${f.error})` : ''}`);
    }
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
