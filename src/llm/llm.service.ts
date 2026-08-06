import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export type LlmIntentResult = {
  intent: 'CREATE_ORDER' | 'CREATE_PURCHASE' | 'UNKNOWN';
  confidence: number;
  needs_clarification: boolean;
  clarifying_questions: string[];
  entities: {
    customerHint?: string;
    supplierHint?: string;
    customerId?: string;
    supplierId?: string;
    reference?: string;
    notes?: string;
    lines?: Array<{
      description?: string;
      size?: string;
      color?: string;
      qty?: number;
    }>;
    paymentMethod?: 'pix' | 'cash' | 'card';
    total?: number;
    orderStatus?: 'open' | 'picking' | 'shipped' | 'completed' | 'cancelled';
    purchaseStatus?: 'pending' | 'received' | 'cancelled';
  };
};

const INTENT_SYSTEM = `You are an assistant for a Brazilian retail ERP. Parse the user message and reply with ONLY valid JSON (no markdown) matching this shape:
{"intent":"CREATE_ORDER"|"CREATE_PURCHASE"|"UNKNOWN","confidence":0-1,"needs_clarification":boolean,"clarifying_questions":string[],"entities":{"customerHint"?:string,"supplierHint"?:string,"customerId"?:string,"supplierId"?:string,"reference"?:string,"notes"?:string,"lines"?:[{"description"?:string,"size"?:string,"color"?:string,"qty"?:number}],"paymentMethod"?:"pix"|"cash"|"card","total"?:number,"orderStatus"?:string,"purchaseStatus"?:string}}
Rules: For CREATE_ORDER, never invent a variantId or a price — just describe each product in "description" (name/team/model, in the user's own words) plus "size"/"color" if they said it; a separate system resolves the real catalog item and price from that text, so don't ask the user to repeat it more precisely. If "qty" isn't said, omit it (defaults to 1). Extract "paymentMethod" only if the user actually said how they were paid ("pix" → "pix", "dinheiro" → "cash", "cartão" → "card"); omit it otherwise. For CREATE_PURCHASE require supplierId or supplierHint.`;

const CASHFLOW_SYSTEM = `You are a financial AI agent for a Brazilian fitness fashion store called LM FIT.
Analyze the provided financial transaction and reply with ONLY valid JSON (no markdown) in this exact format:
{"category":"vendas_cartao"|"pix_cliente"|"pix_fornecedor"|"retirada"|"imposto"|"outros","customerHint":string|null,"entityType":"natural_person"|"legal_entity"|"unknown","isRevenue":boolean,"confidence":0-1,"notes":string}
Rules:
- deposit_sales = always credit card sales via InfinitePay POS
- pix_received = usually customer payment (isRevenue: true)
- pix_sent = outgoing (supplier, withdrawal, expense); isRevenue: false
- customerHint = name of the person or company that made the payment (only for pix_received)
- entityType = analyze the name to determine if it is a natural person (pessoa física) or a legal entity (pessoa jurídica). Look for company indicators like "LTDA", "S.A.", "ME", "COMERCIO", or CNPJ formatting. If it's a standard human name, classify as "natural_person".
- notes = brief summary in English of what this transaction likely represents`;

/** Base URLs for OpenAI-compatible chat-completions APIs backing open-weight models. */
const PROVIDER_BASE_URLS: Record<string, string> = {
  groq: 'https://api.groq.com/openai/v1',
  together: 'https://api.together.xyz/v1',
  deepinfra: 'https://api.deepinfra.com/v1/openai',
  openrouter: 'https://openrouter.ai/api/v1',
};

/** Extracts the first balanced-looking JSON object/array from a model response,
 * in case the provider ignores the json_object response_format instruction. */
function extractJson(raw: string, brackets: '{}' | '[]' = '{}'): string {
  const [open, close] = brackets;
  const start = raw.indexOf(open);
  const end = raw.lastIndexOf(close);
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

@Injectable()
export class LlmService {
  private readonly log = new Logger(LlmService.name);

  constructor(private readonly config: ConfigService) {}

  private getSettings() {
    const provider = this.config.get<string>('LLM_PROVIDER') ?? 'groq';
    const apiKey = this.config.get<string>('LLM_API_KEY');
    const model = this.config.get<string>('LLM_MODEL') ?? 'llama-3.3-70b-versatile';
    const baseUrl =
      this.config.get<string>('LLM_BASE_URL') ?? PROVIDER_BASE_URLS[provider] ?? PROVIDER_BASE_URLS.groq;
    return { apiKey, model, baseUrl };
  }

  /** Calls the chat-completions endpoint and returns the raw text content. */
  private async chatCompletion(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    opts: { maxTokens?: number; jsonMode?: boolean } = {},
  ): Promise<string> {
    const { apiKey, model, baseUrl } = this.getSettings();
    if (!apiKey) {
      throw new Error('LLM_API_KEY not configured');
    }
    const { maxTokens = 2048, jsonMode = true } = opts;
    const res = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model,
        messages,
        temperature: 0.1,
        max_tokens: maxTokens,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30_000,
      },
    );
    const content = res.data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Empty LLM response');
    }
    return content.trim();
  }

  private async chat(systemPrompt: string, userText: string, maxTokens = 2048): Promise<string> {
    return this.chatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
      { maxTokens },
    );
  }

  /**
   * Storefront chatbot reply. Asks the model for structured JSON (reply text +
   * zero or more cart actions, so a single message can add several products) —
   * the caller must still validate each action against real catalog data.
   */
  async chatReplyWithAction(
    systemPrompt: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<{ reply: string; actions: Record<string, unknown>[] }> {
    const { apiKey } = this.getSettings();
    if (!apiKey) {
      return { reply: 'Desculpe, o assistente virtual está indisponível no momento.', actions: [] };
    }
    try {
      const out = await this.chatCompletion(
        [{ role: 'system', content: systemPrompt }, ...history],
        { maxTokens: 1024, jsonMode: true },
      );
      const parsed = JSON.parse(extractJson(out)) as { reply?: string; actions?: Record<string, unknown>[] };
      return {
        reply: typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply : 'Como posso ajudar?',
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      };
    } catch (e) {
      this.log.error('chatReplyWithAction failed', e as Error);
      return { reply: 'Desculpe, não consegui responder agora. Tente novamente em instantes.', actions: [] };
    }
  }

  /**
   * Loop 12-A — transcreve um áudio (venda/compra ditada por voz no WhatsApp) pra texto, que daí
   * em diante segue pro MESMO `parseIntent` de sempre — o resto do pipeline nunca precisa saber
   * que a mensagem original era voz, não texto. Endpoint separado do de chat (mesma chave/conta),
   * confirmado ao vivo contra a Groq antes de escrever este método.
   */
  async transcribeAudio(audio: Buffer, mimeType: string): Promise<string> {
    const { apiKey, baseUrl } = this.getSettings();
    if (!apiKey) {
      throw new Error('LLM_API_KEY not configured');
    }
    const model = this.config.get<string>('LLM_TRANSCRIPTION_MODEL') ?? 'whisper-large-v3-turbo';
    // Groq classifies the upload by the FILENAME extension, not the multipart Content-Type —
    // a generic 'audio' filename (no extension) fails with a 400 even for a supported format.
    const extension = mimeType.split('/')[1]?.split(';')[0]?.trim() || 'ogg';
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), `audio.${extension}`);
    form.append('model', model);
    form.append('language', 'pt');

    const res = await axios.post(`${baseUrl}/audio/transcriptions`, form, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 30_000,
    });
    const text = res.data?.text;
    if (typeof text !== 'string') {
      throw new Error('Empty transcription response');
    }
    return text.trim();
  }

  async parseIntent(text: string): Promise<LlmIntentResult> {
    const { apiKey } = this.getSettings();
    if (!apiKey) {
      this.log.warn('LLM_API_KEY missing; returning UNKNOWN');
      return {
        intent: 'UNKNOWN',
        confidence: 0,
        needs_clarification: true,
        clarifying_questions: ['LLM_API_KEY not configured'],
        entities: {},
      };
    }
    const out = await this.chat(INTENT_SYSTEM, `Message:\n${text}`);
    const parsed = JSON.parse(extractJson(out)) as LlmIntentResult;
    if (!parsed || typeof parsed.confidence !== 'number') {
      throw new Error('Invalid LLM JSON');
    }
    return parsed;
  }

  async analyzeTransaction(text: string): Promise<{
    category: string;
    customerHint: string | null;
    entityType?: string;
    isRevenue: boolean;
    confidence: number;
    notes: string;
  }> {
    const { apiKey } = this.getSettings();
    if (!apiKey) {
      return {
        category: 'other',
        customerHint: null,
        entityType: 'unknown',
        isRevenue: false,
        confidence: 0,
        notes: 'LLM_API_KEY not configured',
      };
    }
    const out = await this.chat(CASHFLOW_SYSTEM, `Transação:\n${text}`);
    return JSON.parse(extractJson(out)) as {
      category: string;
      customerHint: string | null;
      isRevenue: boolean;
      confidence: number;
      notes: string;
    };
  }

  async parseInfinitePayPdf(text: string): Promise<any[]> {
    const { apiKey } = this.getSettings();
    if (!apiKey) {
      throw new Error('LLM_API_KEY is not configured');
    }
    const prompt = `You are a financial parsing AI. Extract ALL transactions from the following raw text from an InfinitePay "Relatório de Movimentações" PDF.
Reply ONLY with a valid JSON array of objects. No markdown formatting.
Each object must match this schema exactly:
{
  "date": "YYYY-MM-DD",
  "hour": "HH:MM",
  "type": "deposit_sales" | "pix_received" | "pix_sent" | "other",
  "name": "Nome da pessoa ou empresa (or empty string)",
  "detail": "Detalhe da transação (or empty string)",
  "amount": number (positive for credit, negative for debit)
}
Rules:
- Parse the dates written in Brazilian Portuguese (e.g., "16 Abr, 2026" becomes "2026-04-16").
- Determine 'type' logically (e.g. "Depósito de vendas" -> "deposit_sales", "Pix recebido" -> "pix_received").
- Convert the monetary value accurately to a number.

Raw PDF Text:
${text}`;

    let out = await this.chat('You are a financial parsing AI that replies only with a JSON array.', prompt, 8192);
    out = extractJson(out, '[]');
    try {
      return JSON.parse(out) as any[];
    } catch {
      // Repair truncated JSON array if generation hit the token limit.
      const lastValidBrace = out.lastIndexOf('}');
      if (lastValidBrace > 0) {
        try {
          return JSON.parse(out.slice(0, lastValidBrace + 1) + ']') as any[];
        } catch {
          // fall through to error below
        }
      }
      this.log.error('Failed to parse LLM output as JSON array', out);
      throw new Error('Failed to parse PDF with LLM');
    }
  }
}
