/**
 *  labels and BRL-style totals inspired by public storefront copy at
 * https://www.kivoni.com.br/ (snapshot ~Apr 2026). Static fixtures only — not synced to the live site.
 */

export const DEMO_SEED_SENTINEL_NOTES = 'SEED_KIVONI_DEMO';

export type SupplierFixture = {
  name: string;
  email?: string;
  phone?: string;
  taxId?: string;
  notes?: string;
};

export type CustomerFixture = {
  name: string;
  email?: string;
  phone?: string;
  taxId?: string;
  legalName?: string;
  cpf?: string;
  whatsappWaId?: string;
  notes?: string;
};

export type OrderFixture = {
  /** Index into `Customers` after insert order matches array order */
  customerIndex: number;
  reference: string;
  total: number;
  status: 'open' | 'picking' | 'shipped' | 'completed' | 'cancelled';
  /** Canal de venda (API); default aplicado no seed se omitido */
  channel?: 'in_person' | 'online' | 'site' | 'whatsapp';
  notes?: string;
};

export type PurchaseLineFixture = {
  variantIndex: number;
  quantityOrdered: number;
  quantityReceived?: number;
};

export type PurchaseFixture = {
  /** Index into `Suppliers` */
  supplierIndex: number;
  reference: string;
  total: number;
  status: 'pending' | 'received' | 'cancelled';
  notes?: string;
  /** Itens (usa `variantIndex` 0 = variante  catálogo seed) */
  lines?: PurchaseLineFixture[];
};

export type InvoiceFixture = {
  number: string;
  amount: number;
  status: 'pending' | 'paid' | 'overdue' | 'cancelled';
  /** ISO date for `dueDate` seed (optional; default +14 days in seed) */
  dueDate?: string;
  /** Index into  orders (same order as `Orders`) */
  orderIndex?: number;
  /** Index into  purchases (same order as `Purchases`) */
  purchaseIndex?: number;
  notes?: string;
};

export const Suppliers: SupplierFixture[] = [
  {
    name: 'Kivoni Atelier — Produção',
    email: 'producao@kivoni.com.br',
    phone: '+55 11 90000-0001',
    taxId: '12.345.678/0001-99',
    notes: DEMO_SEED_SENTINEL_NOTES,
  },
  {
    name: 'Fornecedor Nacional Acessórios',
    email: 'compras@acessorios.com.br',
    phone: '+55 21 90000-0002',
    taxId: '98.765.432/0001-11',
    notes: 'Peças e utilitários esportivos',
  },
];

export const Customers: CustomerFixture[] = [
  {
    name: 'Ana Paula Ferreira',
    email: 'ana.ferreira@example.com',
    phone: '+55 11 98888-0001',
    whatsappWaId: '5511988880001',
    taxId: '529.982.247-25',
    cpf: '529.982.247-25',
    legalName: 'Ana Paula Ferreira',
    notes: 'Cliente recorrente — zona sul SP',
  },
  {
    name: 'Juliana Costa',
    email: 'juliana.costa@example.com',
    phone: '+55 21 97777-0002',
    whatsappWaId: '5521977770002',
    taxId: '390.533.447-05',
    cpf: '390.533.447-05',
  },
  {
    name: 'Mariana Oliveira',
    email: 'mariana.oliveira@example.com',
    phone: '+55 31 96666-0003',
    whatsappWaId: '5531966660003',
  },
];

/** Catalog-style lines and totals (BRL) aligned with homepage sections */
export const Orders: OrderFixture[] = [
  {
    customerIndex: 0,
    reference: 'Shorts Liz',
    total: 69,
    status: 'completed',
    channel: 'site',
    notes: 'Listagem lançamentos / outlet — valor promocional',
  },
  {
    customerIndex: 1,
    reference: 'Conjunto Alci',
    total: 189,
    status: 'completed',
    channel: 'whatsapp',
  },
  {
    customerIndex: 0,
    reference: 'Garrafa HydraFit',
    total: 15,
    status: 'completed',
    channel: 'online',
  },
  {
    customerIndex: 2,
    reference: 'Bolsa Sacola Esportiva Kivoni',
    total: 25,
    status: 'completed',
    channel: 'in_person',
  },
  {
    customerIndex: 1,
    reference: 'Bermuda Helo',
    total: 59,
    status: 'open',
    channel: 'site',
  },
  {
    customerIndex: 2,
    reference: 'Conjunto Flow',
    total: 175,
    status: 'completed',
    channel: 'whatsapp',
  },
  {
    customerIndex: 0,
    reference: 'Jaqueta Lyah',
    total: 99,
    status: 'completed',
    channel: 'online',
  },
];

export const Purchases: PurchaseFixture[] = [
  {
    supplierIndex: 0,
    reference: 'Reposição malha — Shorts Liz (lote)',
    total: 69 * 12,
    status: 'received',
    notes: 'Inspirado em listagem Shorts Liz',
  },
  {
    supplierIndex: 0,
    reference: 'Corte e costura — Conjunto Alci / Conjunto Flow',
    total: 189 + 175,
    status: 'received',
  },
  {
    supplierIndex: 1,
    reference: 'Garrafa HydraFit — importação',
    total: 15 * 48,
    status: 'received',
  },
  {
    supplierIndex: 1,
    reference: 'Bolsa Sacola Esportiva Kivoni — brindes',
    total: 25 * 30,
    status: 'pending',
    lines: [{ variantIndex: 0, quantityOrdered: 30, quantityReceived: 0 }],
  },
];

export const Invoices: InvoiceFixture[] = [
  {
    number: 'NF-240001',
    amount: 69,
    status: 'paid',
    orderIndex: 0,
    notes: 'Fatura pedido Shorts Liz',
  },
  {
    number: 'NF-240002',
    amount: 189 + 175,
    status: 'paid',
    purchaseIndex: 1,
    notes: 'Custo atelier — Conjunto Alci + Flow',
  },
  {
    number: 'NF-240003',
    amount: 15 * 48,
    status: 'cancelled',
    purchaseIndex: 2,
    notes: 'Compra acessórios — fatura cancelada',
  },
  {
    number: 'NF-240004',
    amount: 59,
    status: 'overdue',
    dueDate: '2025-11-01T12:00:00.000Z',
    orderIndex: 4,
    notes: 'Pedido Bermuda Helo — vencida',
  },
  {
    number: 'NF-240005',
    amount: 25 * 30,
    status: 'pending',
    orderIndex: 3,
    purchaseIndex: 3,
    notes: 'Bolsa Sacola — pedido + compra pendente',
  },
];
