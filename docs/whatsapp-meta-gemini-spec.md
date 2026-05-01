# Technical spec: Meta WhatsApp + Gemini (auto-post)

**Choices:** Meta WhatsApp Cloud API (not Twilio BSP). **Auto-post:** persisted `Order` / `Purchase` records are created/updated automatically when the pipeline succeeds (with guardrails below).

**Repo alignment:** NestJS modules under [`src/`](../src/), existing `orders`, `purchases`, `customers`, `suppliers`, `users`, MongoDB.

---

## 1. Guardrails for auto-post (required)

| Rule | Behavior |
|------|----------|
| **Sender allowlist** | Inbound `wa_id` (E.164) must map to a `WhatsAppSender` document (`allowed: true`) or to a `User`/`Supplier` contact field; otherwise log + optional auto-reply “não autorizado”. |
| **Gemini confidence** | If `confidence < 0.75` or `needs_clarification === true`, **do not** auto-post; store `WhatsAppMessage` + notify staff for manual handling. |
| **Idempotency** | Dedupe by WhatsApp `messages[].id` (`wamid`); never create duplicate orders for the same inbound id. |
| **Transactional boundary** | Persist inbound message → run Gemini → if auto-post, `create`/`update` in one logical unit; on failure, mark message `failed` and alert staff. |

---

## 2. Environment variables (exact names)

Add to `.env` / `.env.example` (secrets via vault in production).

### Meta WhatsApp Cloud API

| Variable | Required | Description |
|----------|----------|-------------|
| `META_APP_SECRET` | Yes | App secret from Meta Developer app (for `X-Hub-Signature-256` verification). |
| `META_WHATSAPP_VERIFY_TOKEN` | Yes | Random string you choose; Meta calls `hub.verify_token` on webhook setup. |
| `META_WHATSAPP_PHONE_NUMBER_ID` | Yes | ID of the WhatsApp Business phone number (Graph API). |
| `META_WHATSAPP_ACCESS_TOKEN` | Yes | System user or long-lived token with `whatsapp_business_messaging`, `whatsapp_business_management`. |
| `META_WHATSAPP_BUSINESS_ACCOUNT_ID` | Optional | For template management / analytics jobs. |
| `META_GRAPH_API_VERSION` | No | Default `v21.0` (bump when Meta deprecates). |

### Google Gemini

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes (dev) | AI Studio API key, or |
| `GOOGLE_APPLICATION_CREDENTIALS` | Alt (prod) | Path to service account JSON if using Vertex with ADC. |
| `GEMINI_MODEL` | No | Default `gemini-2.0-flash` (or team’s pinned model id). |
| `GEMINI_LOCATION` | If Vertex | e.g. `us-central1` |

### App URLs & staff notifications

| Variable | Required | Description |
|----------|----------|-------------|
| `PUBLIC_API_BASE_URL` | Yes | Public HTTPS URL of this API (e.g. `https://api.lmfit.example`) for deep links in emails. |
| `WEB_ADMIN_BASE_URL` | Yes | Base URL of `lmfit-web` for links in staff emails (`https://admin.lmfit.example`). |
| `STAFF_NOTIFY_EMAILS` | Optional | Comma-separated list; if set, send on each auto-post / escalation. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | If email | Or replace with SendGrid/SES-specific vars in a thin `MailModule`. |
| `STAFF_NOTIFY_WHATSAPP_TEMPLATE_NAME` | Optional | Approved template name for staff alerts (language `pt_BR`). |
| `STAFF_NOTIFY_WHATSAPP_TEMPLATE_LANG` | No | Default `pt_BR`. |

Existing vars unchanged: `MONGODB_URI`, `JWT_*`, `WEB_ORIGIN`, `PORT`, etc.

---

## 3. HTTP endpoints

### 3.1 Webhook verification (Meta subscription)

| Method | Path | Query | Response |
|--------|------|-------|----------|
| `GET` | `/webhooks/whatsapp` | `hub.mode`, `hub.verify_token`, `hub.challenge` | If `hub.verify_token === META_WHATSAPP_VERIFY_TOKEN` and `hub.mode === subscribe`, return **plain text** `hub.challenge` (200). Else 403. |

**Controller:** `WhatsAppWebhookController` in `src/whatsapp/whatsapp-webhook.controller.ts` (no JWT; public).

### 3.2 Webhook events (inbound messages)

| Method | Path | Body | Headers | Response |
|--------|------|------|---------|----------|
| `POST` | `/webhooks/whatsapp` | Raw JSON body (Meta payload) | `X-Hub-Signature-256` | Verify HMAC SHA256 with `META_APP_SECRET`; on success enqueue or process; return **200 quickly** with empty body. On bad signature: **403**. |

**Signature:** `sha256=` + HMAC of **raw** body (use `rawBody: true` in Nest or dedicated middleware).

**Note:** Subscribe in Meta App to `messages` (and optionally `message_template_status_update` for template delivery receipts).

### 3.3 Internal / admin (optional phase 1.5)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/internal/whatsapp/messages` | JWT + `admin` | Paginated list for support. |
| `POST` | `/internal/whatsapp/replay/:messageId` | JWT + `admin` | Re-run Gemini + pipeline (debug). |

---

## 4. DTOs (request validation)

### 4.1 Meta GET verification (query DTO)

```ts
// hub-verify.query.dto.ts
hub.mode: string;        // 'subscribe'
hub.verify_token: string;
hub.challenge: string;
```

Use `class-validator` optional; query params are strings.

### 4.2 Meta POST payload (partial types, not full Graph validation)

Store **raw JSON** on `WhatsAppMessage.rawPayload`. For typing inbound text, minimum extract:

```ts
// meta-webhook-entry.dto.ts (structural subset)
interface MetaWebhookPayload {
  object: 'whatsapp_business_account';
  entry: Array<{
    id: string;
    changes: Array<{
      field: 'messages';
      value: {
        messaging_product: 'whatsapp';
        metadata: { display_phone_number: string; phone_number_id: string };
        contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
        messages?: Array<{
          from: string;
          id: string;           // wamid — idempotency key
          timestamp: string;
          type: 'text' | 'image' | ...;
          text?: { body: string };
        }>;
        statuses?: unknown[];  // delivery receipts — ack only
      };
    }>;
  }>;
}
```

Validate with a **Zod** or manual guard: if no `messages[]`, return 200 after logging.

### 4.3 Gemini output contract (strict JSON from model)

```ts
// gemini-intent-response.dto.ts (validated after parse)
{
  "intent": "CREATE_ORDER" | "CREATE_PURCHASE" | "UNKNOWN",
  "confidence": number,              // 0..1
  "needs_clarification": boolean,
  "clarifying_questions": string[],
  "entities": {
    "customerHint"?: string,       // name or phone fragment
    "supplierHint"?: string,
    "customerId"?: string,       // Mongo ObjectId if resolved
    "supplierId"?: string,
    "reference"?: string,
    "notes"?: string,
    "lines"?: Array<{ "description": string; "qty": number; "unitPrice"?: number }>,
    "total"?: number,
    "orderStatus"?: "draft" | "paid" | "fulfilled" | "cancelled",
    "purchaseStatus"?: "pending" | "received" | "cancelled"
  }
}
```

Map `CREATE_ORDER` → existing `OrdersService.create(...)`.  
Map `CREATE_PURCHASE` → `PurchasesService.create(...)`.  
Resolve `customerId` / `supplierId` from hints via small DB lookups (fuzzy match capped) or require explicit id in message for v1.

---

## 5. Mongoose collections (new)

| Collection | Purpose |
|------------|---------|
| `WhatsAppMessage` | `wamid`, `fromWaId`, `type`, `textBody`, `rawPayload`, `processingStatus` (`received` \| `parsed` \| `auto_posted` \| `escalated` \| `failed`), `geminiRaw`, `linkedOrderId?`, `linkedPurchaseId?`, `error?`, timestamps. |
| `WhatsAppSender` | `waId` (unique), `label?`, `allowed` (bool), `linkedUserId?`, `linkedSupplierId?`, `notes?`. |
| `GeminiRun` (optional) | `messageId`, `model`, `promptHash`, `responseJson`, `latencyMs` — audit. |

Indexes: `WhatsAppMessage.wamid` **unique**; `WhatsAppMessage.fromWaId` + `createdAt`; `WhatsAppSender.waId` **unique**.

---

## 6. Module layout (`src/`)

```
src/
  whatsapp/
    whatsapp.module.ts
    whatsapp-webhook.controller.ts
    meta-signature.middleware.ts   // or raw body middleware
    meta-webhook.parser.ts         // extract messages[], statuses[]
    whatsapp-messages.service.ts   // persist + idempotency
  gemini/
    gemini.module.ts
    gemini.service.ts              // generateContent + JSON parse + DTO validate
    prompts/
      inbound-order.system.md      // or inline template
  chatops/                         // orchestration name TBD
    chatops.module.ts
    inbound-message.processor.ts   // allowlist → gemini → orders/purchases → notify
  notifications/
    notifications.module.ts
    notifications.service.ts       // email + Meta template send
```

**Dependencies (npm):** `@google/generative-ai` (or `@google-cloud/vertexai`), `nodemailer` or provider SDK; `crypto` built-in for HMAC.

---

## 7. Staff notification content (auto-post success)

- **Email:** subject `[LM FIT] Novo pedido via WhatsApp`, body: customer/supplier hints, Gemini summary, IDs, link `${WEB_ADMIN_BASE_URL}/orders?id=...` or purchases equivalent.
- **WhatsApp (staff):** use **pre-approved template** with variables (order id, from phone, one line summary); send to numbers configured in `STAFF_NOTIFY_WHATSAPP_NUMBERS` (new env: comma-separated E.164).

---

## 8. Sequence (implementation order)

1. `docker-compose` / Mongo already OK; add env keys to `.env.example`.
2. `GET` + `POST` `/webhooks/whatsapp` with signature verification + persist `WhatsAppMessage`.
3. `GeminiService` + prompt returning JSON matching §4.3.
4. `InboundMessageProcessor`: allowlist + confidence + idempotency → `OrdersService` / `PurchasesService`.
5. `NotificationsService`: email + optional Meta template to staff.
6. Tests: unit (signature, idempotency), integration with mocked Meta body + mocked Gemini.

---

## 9. Meta dashboard checklist (ops, not code)

- Create Meta app → WhatsApp → attach Business Portfolio.
- Add webhook URL `https://<PUBLIC_API_BASE_URL>/webhooks/whatsapp`.
- Subscribe to `messages` field for the WABA.
- Generate permanent system user token with correct permissions.
- Register staff notification **message templates** and wait for approval before relying on WhatsApp staff alerts.

This document is the contract for **phase 0–1 implementation** when you ask to build it in `lmfit-api`.
