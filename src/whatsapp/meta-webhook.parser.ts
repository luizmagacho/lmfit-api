export type ParsedInbound = {
  wamid: string;
  fromWaId: string;
  type: string;
  textBody?: string;
};

export function extractInboundMessages(
  payload: Record<string, unknown>,
): ParsedInbound[] {
  const out: ParsedInbound[] = [];
  if (payload?.object !== 'whatsapp_business_account') return out;
  const entry = payload.entry as unknown[] | undefined;
  if (!Array.isArray(entry)) return out;
  for (const e of entry) {
    const changes = (e as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const ch of changes) {
      const value = (ch as { value?: Record<string, unknown> })?.value;
      const messages = value?.messages as unknown[] | undefined;
      if (!Array.isArray(messages)) continue;
      for (const m of messages) {
        const msg = m as Record<string, unknown>;
        const id = msg.id as string | undefined;
        const from = msg.from as string | undefined;
        const type = (msg.type as string) ?? 'unknown';
        if (!id || !from) continue;
        const text =
          (msg.text as { body?: string } | undefined)?.body ??
          (typeof msg.body === 'string' ? msg.body : undefined);
        out.push({
          wamid: id,
          fromWaId: from,
          type,
          textBody: text,
        });
      }
    }
  }
  return out;
}
