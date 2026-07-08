# LM FIT API — Worktree Verification & Market Benchmark

## On every new session / worktree: run this checklist first

### 1. Quick health check
```bash
# Confirm API compiles with no TS errors
npm run build --if-present 2>&1 | tail -20

# Confirm all tests pass
npm test -- --passWithNoTests 2>&1 | tail -30
```

### 2. Tenant isolation audit
Every resource that stores tenant data MUST have:
- `tenantId` field on its Mongoose schema
- All `find*` queries filter by `{ tenantId }`
- `create` sets `tenantId` from the request header (via `@TenantId()` decorator)
- Controller passes `tenantId` to every service call

Known gaps to check: `materials`, `products/variants`, `cashflow`, `invoices`, `payments`, `production/batches`.

### 3. Plan-gating audit
Features that require non-free plans must use `@RequireFeature(Feature.X)` + `FeatureGuard`.
Check that all financial routes (`/cashflow`, `/invoices`, `/payments`, `/production/batches`) have the guard.

### 4. API contract completeness
Compare `src/` modules against what the web (`lmfit-web`) and mobile (`lmfit-mobile`) consume.
Look for endpoints referenced in the front-end that don't exist, or exist but return wrong shape.

---

## Market benchmark — what best-in-class B2B SaaS APIs do (2025)

| Area | Current state | Market standard | Gap |
|------|--------------|-----------------|-----|
| Auth | JWT + refresh token | JWT + refresh + PKCE OAuth / SSO (Google/Microsoft) | No OAuth/SSO |
| Multi-tenancy | Slug header | Row-level isolation (RLS) or schema-per-tenant | Header-based is fine for MVP |
| Rate limiting | None detected | Per-tenant throttle (NestJS ThrottlerModule) | Add throttle guard |
| Audit log | None detected | Append-only audit trail per resource change | Missing |
| Pagination | offset/limit | Cursor-based (stable under concurrent inserts) | Offset is ok for small data |
| Search | MongoDB regex | Full-text index (`$text`) or Elasticsearch | Add `$text` index |
| File uploads | Local/S3 | S3 pre-signed URLs, virus scan | Add pre-signed URL endpoint |
| API versioning | None | `/v1/` prefix or `Accept-Version` header | Add before v1 public release |
| OpenAPI | Swagger (partial) | Complete spec + auto-generated client SDKs | Complete Swagger decorators |
| Webhooks | None | Outgoing webhooks for order/purchase events | Roadmap item |
| Background jobs | Bull/BullMQ unknown | BullMQ + Redis with retry + dead-letter queue | Verify BullMQ setup |
| Observability | Logger only | Structured JSON logs + Sentry/Datadog traces | Add structured logging |

## Priority improvements (do these first)

1. **Rate limiting** — `@nestjs/throttler` per tenant, 100 req/min default
2. **Full-text search** — MongoDB `$text` index on name/reference fields across all list endpoints
3. **Audit log** — middleware that writes `{ tenantId, userId, action, resourceType, resourceId, before, after }` on every mutating request
4. **Materials tenant isolation** — `tenantId` is missing from the Material schema (confirmed gap)
5. **Pre-signed upload URLs** — move file uploads off the NestJS process onto S3 pre-signed URLs

## Multi-tenant context
- Tenant resolved via `x-tenant-slug` HTTP header → `@TenantId()` decorator extracts `tenantId` from JWT payload
- `lmfit` tenant slug (inside Kivoni) has **enterprise plan** — all features unlocked
- Seed credentials: `admin@kivoni.local` / `ChangeMe123!`
- API port: 4000, start with `npm run start:dev`
