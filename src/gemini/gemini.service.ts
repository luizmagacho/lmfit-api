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
    orderStatus?: 'draft' | 'paid' | 'fulfilled' | 'cancelled';
    purchaseStatus?: 'pending' | 'received' | 'cancelled';
  };
};

const SYSTEM = `You are an assistant for a Brazilian retail ERP. Parse the user message and reply with ONLY valid JSON (no markdown) matching this shape:
{"intent":"CREATE_ORDER"|"CREATE_PURCHASE"|"UNKNOWN","confidence":0-1,"needs_clarification":boolean,"clarifying_questions":string[],"entities":{"customerHint"?:string,"supplierHint"?:string,"customerId"?:string,"supplierId"?:string,"reference"?:string,"notes"?:string,"lines"?:[{"variantId"?:string,"description"?:string,"qty"?:number,"unitPrice"?:number}],"total"?:number,"orderStatus"?:string,"purchaseStatus"?:string}}
Rules: For CREATE_ORDER every line must include variantId (Mongo ObjectId string) if the user did not give one, set needs_clarification true. For CREATE_PURCHASE require supplierId or supplierHint.`;

@Injectable()
export class GeminiService {
  private readonly log = new Logger(GeminiService.name);

  constructor(private readonly config: ConfigService) {}

  async parseIntent(text: string): Promise<GeminiIntentResult> {
    const key = this.config.get<string>('GEMINI_API_KEY');
    const modelId = this.config.get<string>('GEMINI_MODEL') ?? 'gemini-2.0-flash';
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
}
