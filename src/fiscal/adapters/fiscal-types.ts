/** Shared shapes across fiscal provider adapters (NuvemFiscal, FocusNfe, …). */

export type NfceItem = {
  descricao: string;
  quantidade: number;
  valorUnitario: number;
  ncm?: string;
};

export type EmitNfceResult = {
  ok: boolean;
  providerId?: string;
  status?: string;
  chaveAcesso?: string;
  qrCodeUrl?: string;
  danfeUrl?: string;
  error?: string;
};
