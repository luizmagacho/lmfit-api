export type OrderWarning = {
  variantId: string;
  type: 'shortfall' | 'pending_purchase';
  messagePtBr: string;
  suggestCreatePurchase: boolean;
  shortfall?: number;
  pendingPurchaseQty?: number;
};
