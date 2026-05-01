/** Canonical values accepted on POST/PATCH (English API keys). */
export const INVOICE_STATUS_CANONICAL = [
  'pending',
  'paid',
  'overdue',
  'cancelled',
] as const;

export type InvoiceStatusCanonical = (typeof INVOICE_STATUS_CANONICAL)[number];

/** Legacy values that may still exist in Mongo until migrated. */
export type InvoiceStatusLegacy = 'open' | 'void';

export type InvoiceStatusStored = InvoiceStatusCanonical | InvoiceStatusLegacy;

const LEGACY_TO_CANONICAL: Record<InvoiceStatusLegacy, InvoiceStatusCanonical> =
  {
    open: 'pending',
    void: 'cancelled',
  };

const LABEL_PT_BR: Record<InvoiceStatusCanonical, string> = {
  pending: 'Pendente',
  paid: 'Paga',
  overdue: 'Vencida',
  cancelled: 'Cancelada',
};

const DESCRIPTION_PT_BR: Record<InvoiceStatusCanonical, string> = {
  pending: 'Aguardando pagamento.',
  paid: 'Fatura quitada.',
  overdue: 'Data de vencimento ultrapassada e pagamento ainda pendente.',
  cancelled: 'Fatura cancelada ou anulada.',
};

/** Map DB value → canonical key for labels and UI logic. */
export function canonicalInvoiceStatus(
  stored: string | undefined,
): InvoiceStatusCanonical {
  if (!stored) return 'pending';
  if (stored in LEGACY_TO_CANONICAL) {
    return LEGACY_TO_CANONICAL[stored as InvoiceStatusLegacy];
  }
  if (INVOICE_STATUS_CANONICAL.includes(stored as InvoiceStatusCanonical)) {
    return stored as InvoiceStatusCanonical;
  }
  return 'pending';
}

export function invoiceStatusLabelPtBr(stored: string | undefined): string {
  return LABEL_PT_BR[canonicalInvoiceStatus(stored)];
}

/** Payload for `GET /invoices/status-options` (and frontend copy). */
export function getInvoiceStatusOptionsPayload() {
  return {
    statuses: INVOICE_STATUS_CANONICAL.map((value) => ({
      value,
      labelPtBr: LABEL_PT_BR[value],
      descriptionPtBr: DESCRIPTION_PT_BR[value],
    })),
    legacyMap: { open: 'pending', void: 'cancelled' } as const,
    notePtBr:
      'Valores antigos na base: `open` equivale a Pendente; `void` equivale a Cancelada. Preferir os quatro valores canônicos em novas gravações.',
  };
}

export function enrichInvoiceWithStatusI18n<T extends { status?: string }>(
  doc: T,
): T & {
  statusLabelPtBr: string;
  statusCanonical: InvoiceStatusCanonical;
} {
  const statusCanonical = canonicalInvoiceStatus(doc.status);
  return {
    ...doc,
    statusLabelPtBr: LABEL_PT_BR[statusCanonical],
    statusCanonical,
  };
}
