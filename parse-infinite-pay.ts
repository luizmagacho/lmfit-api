const SYSTEM = `You are an AI that extracts transactions from a raw InfinitePay PDF text.
Extract an array of transactions in JSON format exactly matching:
[{"date":"YYYY-MM-DD","hour":"HH:MM","type":"deposit_sales"|"pix_received"|"pix_sent"|"other","name":"...","detail":"...","amount":number}]
Rules:
- amount is a number (positive for credit, negative for debit).
- Use Brazilian dates (e.g. "16 Abr, 2026" -> "2026-04-16").
Return ONLY the JSON array, nothing else.`;
