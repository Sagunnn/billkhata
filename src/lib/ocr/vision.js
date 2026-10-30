// Structured bill extraction with a user-supplied vision API key.
// Calls go straight from the browser to the provider; nothing passes through a server.
import { CATEGORIES, PAYMENT_METHODS } from '../constants.js';

const PROMPT = `You are reading a photo of a shop bill or receipt, usually from Nepal (PAN/VAT bills, often handwritten or mixed Nepali/English).
Extract these fields. Use an empty string or 0 when a field is not on the bill; do not guess.
- merchantName: the seller / shop name as printed.
- sellerPan: the seller's 9-digit PAN or VAT number (near "PAN", "VAT", "प्यान", "स्थायी लेखा नम्बर"). Digits only.
- invoiceNumber: bill / invoice number ("Bill No", "Inv No", "Invoice #", "बिल नं", "बिजक नं"), exactly as printed but with Devanagari digits converted.
- billDateAD: the bill date in the Gregorian calendar as YYYY-MM-DD, only if the bill shows an AD date.
- billDateBS: the bill date in Bikram Sambat as YYYY-MM-DD (years around 2080), only if the bill shows a BS date.
- totalAmount: the final amount payable (grand total), a number.
- vatAmount: the 13% VAT amount if shown, a number.
- paymentMethod: "${PAYMENT_METHODS[1]}" if the bill shows it was paid by Fonepay, QR, eSewa, Khalti, mobile banking, connectIPS or a card; otherwise "${PAYMENT_METHODS[0]}".
- category: the best fit from the list.
- isNepalBill: true if this is a Nepali bill (NPR, रु, Nepali PAN/VAT, Nepali address).
- lineItems: every purchased item row on an itemised bill (restaurant, café, bar, shop), in order:
  name as printed, qty, price (unit rate) and amount (line total before VAT / service charge).
  Leave out subtotal, service charge, VAT, discount and total rows. Use [] if the bill has no item rows.
Convert Devanagari digits (०-९) to 0-9.`;

export const BILL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['merchantName', 'sellerPan', 'invoiceNumber', 'billDateAD', 'billDateBS', 'totalAmount', 'vatAmount', 'paymentMethod', 'category', 'isNepalBill', 'lineItems'],
  properties: {
    merchantName: { type: 'string' },
    sellerPan: { type: 'string' },
    invoiceNumber: { type: 'string' },
    billDateAD: { type: 'string' },
    billDateBS: { type: 'string' },
    totalAmount: { type: 'number' },
    vatAmount: { type: 'number' },
    paymentMethod: { type: 'string', enum: PAYMENT_METHODS.slice(0, 2) },
    category: { type: 'string', enum: CATEGORIES },
    isNepalBill: { type: 'boolean' },
    lineItems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'qty', 'price', 'amount'],
        properties: {
          name: { type: 'string' },
          qty: { type: 'number' },
          price: { type: 'number' },
          amount: { type: 'number' },
        },
      },
    },
  },
};

function splitDataUrl(dataUrl) {
  const [head, data] = dataUrl.split(',');
  return { mediaType: head.match(/data:([^;]+)/)?.[1] || 'image/jpeg', data };
}

function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('The model did not return readable bill data.');
  }
}

async function gemini(image, { apiKey, model }) {
  const { mediaType, data } = splitDataUrl(image);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: mediaType, data } }, { text: PROMPT }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message || `Gemini request failed (${res.status}).`);
  return parseJson(body.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '');
}

async function openai(image, { apiKey, model }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `${PROMPT}\nReply with one JSON object with exactly these keys: ${BILL_SCHEMA.required.join(', ')}.` },
          { type: 'image_url', image_url: { url: image } },
        ],
      }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message || `OpenAI request failed (${res.status}).`);
  return parseJson(body.choices?.[0]?.message?.content);
}

async function anthropic(image, { apiKey, model }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // The key is the user's own and stays in their browser.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const { mediaType, data } = splitDataUrl(image);
  let response;
  try {
    response = await client.beta.messages.create({
      model,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: BILL_SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: PROMPT },
        ],
      }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('Claude rejected the API key.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('Claude rate limit reached. Try again shortly.');
    if (err instanceof Anthropic.APIError) throw new Error(err.message || `Claude request failed (${err.status}).`);
    throw err;
  }
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to read this image.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return parseJson(text);
}

const PROVIDERS = { gemini, openai, anthropic };

export async function extractWithVision(image, { provider, apiKey, model }) {
  const fn = PROVIDERS[provider];
  if (!fn) throw new Error(`Unknown provider: ${provider}`);
  return fn(image, { apiKey, model });
}
