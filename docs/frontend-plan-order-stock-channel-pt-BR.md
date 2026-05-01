# Plano de implementação (front): pedidos 1-N, canal, status, estoque e avisos de compra

Este documento descreve o que o **painel web** (`lmfit-web`, Next.js) deve implementar para ficar alinhado às APIs do `lmfit-api` já entregues: **linhas de pedido (1-N variantes)**, **cliente**, **canal de venda**, **status**, **baixa de estoque no pagamento/atendimento**, **avisos** (`warnings`) e **compras ao fornecedor com linhas** (para o alerta de “compra pendente”).

**Base URL:** `NEXT_PUBLIC_API_URL` (ex.: `http://localhost:4000`). **Auth:** `Authorization: Bearer <jwt>`.

---

## 1. Escopo e princípios

| Área | Comportamento esperado no front |
|------|----------------------------------|
| **Pedido** | Formulário com **cliente** + **canal** + **status** + **linhas** (variante, quantidade, preço unitário, descrição opcional). Total exibido = soma das linhas (ou espelho do `total` retornado pela API). |
| **1-N** | Uma ou mais linhas; mesma variante pode aparecer mais de uma vez (o backend agrupa para estoque). |
| **Canal** | Campo obrigatório na UX (default sugerido: `online`). Valores canônicos da API (não traduzir na chave): `in_person`, `online`, `site`, `whatsapp`. Labels PT-BR na UI. |
| **Status** | `draft`, `paid`, `fulfilled`, `cancelled`. Transições que **exigem estoque** ao ir para `paid` ou `fulfilled`: tratar **422** e mostrar `conflicts`. |
| **Avisos** | Sempre que a API devolver `warnings[]`, exibir bloco não bloqueante (banner/toast secundário ou lista), com CTA quando `suggestCreatePurchase === true`. |
| **Edição** | Se `status` for `paid` ou `fulfilled`, **não permitir editar linhas** (a API rejeita com 422); apenas outros campos (ex.: referência, observações, canal se fizer sentido). |

---

## 2. Contratos da API (referência rápida)

### 2.1 Pedido — criar / detalhe / atualizar

- **POST** `/orders` — body alinhado ao `CreateOrderDto`: `customerId`, `channel?`, `status?`, `reference?`, `notes?`, `lines?`.
- **GET** `/orders/:id` — resposta inclui **`warnings`** (pode ser `[]`).
- **PATCH** `/orders/:id` — `UpdateOrderDto`: `channel?`, `status?`, `reference?`, `total?`, `notes?`, `lines?` (linhas **bloqueadas** se já `paid`/`fulfilled`).

**Resposta enriquecida (create / get / patch):** objeto do pedido + array:

```json
"warnings": [
  {
    "variantId": "...",
    "type": "shortfall",
    "messagePtBr": "...",
    "suggestCreatePurchase": true,
    "shortfall": 3
  },
  {
    "variantId": "...",
    "type": "pending_purchase",
    "messagePtBr": "...",
    "suggestCreatePurchase": false,
    "pendingPurchaseQty": 12
  }
]
```

### 2.2 Erro 422 — estoque insuficiente ao pagar / atender

Ao enviar `status: "paid"` ou `"fulfilled"` sem estoque suficiente:

```json
{
  "message": "Não foi possível concluir: estoque insuficiente para marcar como pago/atendido.",
  "conflicts": [
    {
      "variantId": "...",
      "sku": "SKU-LOW",
      "needed": 5,
      "available": 1,
      "messagePtBr": "..."
    }
  ]
}
```

O front deve mapear `message` (padrão Nest) e, se existir, listar **`conflicts`** com destaque por SKU/variante.

### 2.3 Listagem e export

- **GET** `/orders?page=1&limit=20&search=...&channel=whatsapp` — filtro opcional `channel` (mesmos valores canônicos).
- **GET** `/orders/export?format=xlsx&search=...&channel=...` — repassar `channel` se a listagem estiver filtrada.

### 2.4 Compras (fornecedor) — linhas

- **POST** `/purchases` / **PATCH** `/purchases/:id` — suportar **`lines`**: `{ variantId, quantityOrdered, quantityReceived? }[]`.
- Import Excel: coluna **Linhas (JSON)** (mesmo padrão de pedidos, se aplicável).

Isso alimenta o aviso `pending_purchase` nos pedidos quando existir compra **pending** com quantidade pendente de recebimento para a variante.

---

## 3. Fases de implementação (front)

### Fase A — Tipos e camada de API

1. **Tipos TypeScript** (ou codegen OpenAPI, se existir no futuro) espelhando:
   - `OrderChannel`, `OrderWarning`, resposta `Order & { warnings: OrderWarning[] }`.
   - Payload de erro 422 com `conflicts?: Array<{ variantId; sku; needed; available; messagePtBr }>`.
2. **Cliente HTTP** (fetch/axios): helper para ler `message` string ou array (padrão Nest) e anexar `conflicts` quando presente.
3. **Hooks ou server actions** para `GET/POST/PATCH` de pedidos, propagando `warnings` no retorno tipado.

### Fase B — UI de listagem de pedidos

1. Colunas: referência, cliente, **canal** (label PT-BR), status, total, data.
2. Filtro **canal** (select) disparando `?channel=` na listagem e no export.
3. Mapeamento **canal** → label:
   - `in_person` → Presencial  
   - `online` → Online  
   - `site` → Site  
   - `whatsapp` → WhatsApp  

### Fase C — Formulário de criação / edição de pedido

1. **Seleção de cliente** (`customerId`) — obrigatório.
2. **Canal** — select com valores canônicos acima.
3. **Status** — select; ao escolher `paid` ou `fulfilled`, opcionalmente chamar validação visual (ver Fase E).
4. **Tabela de linhas**: adicionar/remover linhas; campos: busca de **variante** (por SKU ou id), **quantidade**, **preço unitário**, descrição opcional; recalcular **total** localmente para preview.
5. **Modo leitura / edição de linhas:** se pedido carregado com `status` em `paid` | `fulfilled`, **desabilitar** edição de linhas e mostrar tooltip explicando a regra da API.
6. Após **salvar** com sucesso: se `warnings.length`, exibir componente de avisos (não substituir toast de sucesso; complementar).

### Fase D — Tratamento de erros e fluxo “pagar”

1. Interceptar **422** no PATCH/POST de pedido quando o motivo for estoque.
2. UI dedicada: título com `message`, lista de `conflicts` com `sku`, `needed`, `available`, `messagePtBr`.
3. CTA sugeridos (copy): “Ajustar quantidades”, “Ir para compras / novo pedido ao fornecedor” (link para rota de compras ou modal rápido, conforme existir no app).

### Fase E — Avisos (`warnings`) e compras

1. Componente reutilizável **`OrderWarningsPanel`**: recebe `warnings`, ícones por `type` (`shortfall` vs `pending_purchase`), destaque para `suggestCreatePurchase`.
2. Para `shortfall` com `suggestCreatePurchase`: botão “Registrar compra” navegando para **`/purchases/new`** (ou equivalente) com query opcional `?variantId=...` se quiserem pré-preencher no futuro (não obrigatório na API hoje).
3. Tela **compra ao fornecedor**: formulário de **linhas** (variante + `quantityOrdered` + opcional `quantityReceived` em recebimentos); alinhar com DTO do backend.
4. Documentar para o usuário interno: compras **pending** com linhas geram aviso `pending_purchase` nos pedidos que usem a mesma variante.

### Fase F — Integrações existentes

1. **Rascunho público → pedido** (`submit` do draft): a API já retorna pedido com `warnings`; após redirect para detalhe do pedido, buscar **GET** `/orders/:id` ou usar resposta se já incluir `warnings`.
2. **WhatsApp / automação** que cria pedido: mesmo tratamento se a resposta incluir `warnings` (log ou banner na ficha do pedido criado).

### Fase G — Testes e QA (front)

1. Teste E2E ou de componente: criar pedido `draft` com linha → `warnings` pode aparecer sem bloquear.
2. Reduzir estoque manualmente (ou usar fixture) → marcar como `paid` → esperar **422** + `conflicts`.
3. Pedido `paid` → tentar editar linha → API 422; UI não deve permitir chegar nesse estado (desabilitar).
4. Filtro `channel` na listagem altera query string e refetch.
5. Compra `pending` com linha para variante X → pedido com linha X mostra `pending_purchase` em `warnings` (dados de demo/seed se disponíveis).

---

## 4. Riscos e decisões de produto (front)

- **Duplicidade de avisos:** a mesma variante pode gerar `shortfall` e `pending_purchase`; exibir os dois de forma clara.
- **Total no PATCH:** se enviar `lines: []` em `draft`, o backend usa `total` do body ou mantém o anterior; na UI, evitar enviar patch inconsistente (validar antes de submit).
- **i18n:** mensagens de negócio já vêm em **`messagePtBr`** nos avisos e conflitos; labels de canal/status podem ficar em catálogo PT-BR do front.

---

## 5. Checklist de entrega

- [ ] Tipos + cliente API com suporte a `warnings` e `conflicts`
- [ ] Listagem + export com filtro `channel`
- [ ] Form pedido: cliente, canal, status, linhas, total
- [ ] Bloqueio de edição de linhas em `paid` / `fulfilled`
- [ ] UI de 422 (estoque) com `conflicts`
- [ ] Painel de `warnings` pós create/get/patch
- [ ] Compras: UI de `lines` alinhada ao backend
- [ ] Testes/QA mínimos descritos na Fase G

---

## 6. Referência no repositório da API

Implementação de referência: `Order` + `OrdersService`, `Purchase` com `lines`, `ProductsService` (ledger `sale` / `sale_reversal`), constantes em `src/orders/types/order-channel.ts` e `src/orders/types/order-warning.ts`.
