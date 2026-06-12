import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

export type GeminiIntentResult = {
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
      variantId?: string;
      description?: string;
      qty?: number;
      unitPrice?: number;
    }>;
    total?: number;
    orderStatus?: 'open' | 'picking' | 'shipped' | 'completed' | 'cancelled';
    purchaseStatus?: 'pending' | 'received' | 'cancelled';
  };
};

const SYSTEM = `You are an assistant for a Brazilian retail ERP. Parse the user message and reply with ONLY valid JSON (no markdown) matching this shape:
{"intent":"CREATE_ORDER"|"CREATE_PURCHASE"|"UNKNOWN","confidence":0-1,"needs_clarification":boolean,"clarifying_questions":string[],"entities":{"customerHint"?:string,"supplierHint"?:string,"customerId"?:string,"supplierId"?:string,"reference"?:string,"notes"?:string,"lines"?:[{"variantId"?:string,"description"?:string,"qty"?:number,"unitPrice"?:number}],"total"?:number,"orderStatus"?:string,"purchaseStatus"?:string}}
Rules: For CREATE_ORDER every line must include variantId (Mongo ObjectId string) if the user did not give one, set needs_clarification true. For CREATE_PURCHASE require supplierId or supplierHint.`;

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

@Injectable()
export class GeminiService {
  private readonly log = new Logger(GeminiService.name);

  constructor(private readonly config: ConfigService) {}

  async parseIntent(text: string): Promise<GeminiIntentResult> {
    const key = this.config.get<string>('GEMINI_API_KEY');
    const modelId = this.config.get<string>('GEMINI_MODEL') ?? 'gemini-2.5-flash';
    if (!key) {
      this.log.warn('GEMINI_API_KEY missing; returning UNKNOWN');
      return {
        intent: 'UNKNOWN',
        confidence: 0,
        needs_clarification: true,
        clarifying_questions: ['GEMINI_API_KEY not configured'],
        entities: {},
      };
    }
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: modelId });
    const res = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: SYSTEM + '\n\nMessage:\n' + text }] }],
    });
    const out = res.response.text().trim();
    const jsonStart = out.indexOf('{');
    const jsonEnd = out.lastIndexOf('}');
    const slice =
      jsonStart >= 0 && jsonEnd > jsonStart ? out.slice(jsonStart, jsonEnd + 1) : out;
    const parsed = JSON.parse(slice) as GeminiIntentResult;
    if (!parsed || typeof parsed.confidence !== 'number') {
      throw new Error('Invalid Gemini JSON');
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
    const key = this.config.get<string>('GEMINI_API_KEY');
    const modelId = this.config.get<string>('GEMINI_MODEL') ?? 'gemini-2.5-flash';
    if (!key) {
      return {
        category: 'other',
        customerHint: null,
        entityType: 'unknown',
        isRevenue: false,
        confidence: 0,
        notes: 'GEMINI_API_KEY not configured',
      };
    }
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: modelId });
    const res = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: CASHFLOW_SYSTEM + '\n\nTransação:\n' + text }] }],
    });
    const out = res.response.text().trim();
    const jsonStart = out.indexOf('{');
    const jsonEnd = out.lastIndexOf('}');
    const slice =
      jsonStart >= 0 && jsonEnd > jsonStart ? out.slice(jsonStart, jsonEnd + 1) : out;
    return JSON.parse(slice) as {
      category: string;
      customerHint: string | null;
      isRevenue: boolean;
      confidence: number;
      notes: string;
    };
  }

  async parseInfinitePayPdf(text: string): Promise<any[]> {
    const key = this.config.get<string>('GEMINI_API_KEY');
    const modelId = this.config.get<string>('GEMINI_MODEL') ?? 'gemini-2.5-flash';
    if (!key) {
      throw new Error('GEMINI_API_KEY is not configured');
    }
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: modelId });

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

    const res = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 8192,
        responseMimeType: "application/json"
      }
    });
    
    let out = res.response.text().trim();
    const jsonStart = out.indexOf('[');
    const jsonEnd = out.lastIndexOf(']');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      out = out.slice(jsonStart, jsonEnd + 1);
    }
    
    try {
      return JSON.parse(out) as any[];
    } catch (e) {
      // Try to repair truncated JSON array if it hit the token limit
      try {
        const lastValidBrace = out.lastIndexOf('}');
        if (lastValidBrace > 0) {
          const repaired = out.slice(0, lastValidBrace + 1) + ']';
          return JSON.parse(repaired) as any[];
        }
      } catch (e2) {
        // Fallback to error logging
      }
      this.log.error('Failed to parse Gemini output as JSON array', out);
      throw new Error('Failed to parse PDF with Gemini');
    }
  }
}
