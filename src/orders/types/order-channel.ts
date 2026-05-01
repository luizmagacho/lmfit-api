export const ORDER_CHANNELS = [
  'in_person',
  'online',
  'site',
  'whatsapp',
] as const;

export type OrderChannel = (typeof ORDER_CHANNELS)[number];
