# Planos e Limites do Kivoni

Este documento detalha os limites de usuários, preços e funcionalidades de cada plano do Kivoni, garantindo consistência em toda a plataforma (API, Web Dashboard e Landing Page).

---

## Tabela Comparativa de Planos

| Recurso / Limite | Grátis (`free`) | Básico (`basic`) | Pro (`pro`) | Enterprise (`enterprise`) |
| :--- | :--- | :--- | :--- | :--- |
| **Preço Mensal** | R$ 0 | R$ 97/mês | R$ 197/mês | R$ 497/mês |
| **Preço Anual** | R$ 0 | R$ 970/ano (10x) | R$ 1.970/ano (10x) | R$ 4.970/ano (10x) |
| **Limite de Usuários** | **1 usuário** | **Até 3 usuários** | **Até 10 usuários** | **Usuários Ilimitados** |
| **Limite de Produtos** | Até 20 produtos | Ilimitados | Ilimitados | Ilimitados |
| **Catálogo Público** | Sim | Sim | Sim | Sim |
| **Pedido via WhatsApp** | Sim | Sim | Sim | Sim |
| **Gestão de Clientes** | Não | Sim | Sim | Sim |
| **Kanban de Pedidos** | Não | Sim | Sim | Sim |
| **Fornecedores** | Não | Sim | Sim | Sim |
| **Relatórios** | Não | Básicos + Exportação | Básicos + Exportação | Avançados |
| **Atacado (Preços B2B)**| Não | Não | Sim | Sim |
| **Lotes de Produção** | Não | Não | Sim | Sim |
| **Chatbot IA WhatsApp** | Não | Não | Sim | Sim |
| **Checkout Integrado** | Não | Não | Sim (PIX/Stripe) | Sim (PIX/Stripe/InfinitePay) |
| **Financeiro Completo** | Não | Não | Não | Sim (Fluxo de Caixa) |
| **Emissão de Notas** | Não | Não | Não | Sim (NF-e e NFC-e) |
| **Acesso via API** | Não | Não | Não | Sim |
| **Suporte** | E-mail | E-mail / Central | WhatsApp Prioritário | Gerente Dedicado |

---

## Definição Técnica das Feature Flags (Backend)

No backend (`TenantsService`), as permissões são mapeadas através de chaves de funcionalidade (`features`):

* **`free`**: `['catalog', 'inventory']`
* **`basic`**: `['catalog', 'inventory', 'customers', 'orders', 'suppliers', 'reports_basic', 'export']`
* **`pro`**: `['catalog', 'inventory', 'customers', 'orders', 'suppliers', 'reports_basic', 'export', 'wholesale', 'production', 'chatbot', 'checkout']`
* **`enterprise`**: `['catalog', 'inventory', 'customers', 'orders', 'suppliers', 'reports_basic', 'export', 'wholesale', 'production', 'chatbot', 'checkout', 'financial', 'invoices', 'reports_advanced', 'api_access']`

---

## Alinhamento no Banco de Dados (Mongoose Schema)

As instâncias de `limits` no banco de dados devem seguir a seguinte resolução automática (caso não haja override manual):

```typescript
const PLAN_LIMITS = {
  free: { maxProducts: 20, maxUsers: 1 },
  basic: { maxProducts: -1, maxUsers: 3 },
  pro: { maxProducts: -1, maxUsers: 10 },
  enterprise: { maxProducts: -1, maxUsers: -1 },
};
```
