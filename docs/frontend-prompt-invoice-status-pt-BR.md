# Frontend prompt — invoice status (API + pt-BR)

Copy the block below into your issue / chat with the **lmfit-web** team.

---

## Context

The control API (`lmfit-api`) uses **English machine values** for `Invoice.status` on **POST/PATCH** and in stored documents. The admin UI should show **Portuguese** labels to staff.

## Canonical `status` values (write + new data)

| Value       | Portuguese (label) | Meaning (pt-BR) |
|------------|--------------------|------------------|
| `pending`  | **Pendente**       | Aguardando pagamento. |
| `paid`     | **Paga**           | Fatura quitada. |
| `overdue`  | **Vencida**        | Prazo ultrapassado e pagamento ainda pendente (“atrasada”). |
| `cancelled`| **Cancelada**      | Fatura cancelada ou anulada. |

Default on create when `status` is omitted: **`pending`**.

## Legacy values (read-only compatibility)

Older MongoDB documents may still have:

| Stored | Treat as canonical | Label (pt-BR) |
|--------|--------------------|---------------|
| `open` | `pending`          | Pendente      |
| `void` | `cancelled`        | Cancelada     |

**POST/PATCH** must use only the **four canonical** values above (not `open` / `void`).

## API helpers for the web client

1. **`GET /invoices/status-options`** (JWT, same roles as invoices)  
   Returns JSON including:
   - `statuses`: array of `{ value, labelPtBr, descriptionPtBr }` for filters and selects.
   - `legacyMap`: `{ "open": "pending", "void": "cancelled" }`.
   - `notePtBr`: short explanation for staff.

2. **List / detail / create / update invoice responses** include:
   - `status` — value as stored (canonical or legacy).
   - `statusLabelPtBr` — Portuguese label for the row/detail (legacy-aware).
   - `statusCanonical` — normalized key (`pending` | `paid` | `overdue` | `cancelled`) for badges, colors, and `switch` logic.

Prefer **`statusCanonical`** + **`statusLabelPtBr`** for UI; keep sending **`status`** (canonical only) on PATCH.

## UI expectations

- Table column “Status”: show **`statusLabelPtBr`** (or map client-side from `status-options`).
- Filters / selects: build options from **`GET /invoices/status-options`** so labels stay in sync with the API.
- Badge colors: key off **`statusCanonical`** (not translated strings).

## Optional client-side fallback

If `status-options` is not loaded yet, you may map:

```ts
const INVOICE_STATUS_LABEL_PT_BR: Record<string, string> = {
  pending: 'Pendente',
  paid: 'Paga',
  overdue: 'Vencida',
  cancelled: 'Cancelada',
  open: 'Pendente',
  void: 'Cancelada',
};
```

Prefer the API payload when online.

---

## OpenAPI

Regenerate or read Swagger at `/docs` → tag **invoices** for exact DTO enums on `CreateInvoiceDto` / `UpdateInvoiceDto`.

## Database migration (ops / one-time)

Existing documents may still use `open` or `void`. Optional MongoDB normalization:

```js
db.invoices.updateMany({ status: 'open' }, { $set: { status: 'pending' } });
db.invoices.updateMany({ status: 'void' }, { $set: { status: 'cancelled' } });
```

After migration, only the four canonical values should remain.
