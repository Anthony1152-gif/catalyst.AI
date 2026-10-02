// AI extraction: sends pasted emails to Claude and gets back items in the same
// shape the offline parser produces (see src/lib/parser.js). Used by both the
// Vite dev server and the production server.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod/v4';

const MODEL = 'claude-opus-5-5';
const MAX_INPUT_CHARS = 150_000;

const Item = z.object({
  kind: z.enum(['subscription', 'trial', 'order']),
  merchant: z.string().describe('Brand name as a customer would say it, e.g. "Netflix", "Best Buy"'),
  amount: z.number().nullable().describe('subscription: recurring price; trial: price charged after the trial; order: refundable total'),
  currency: z.enum(['USD', 'EUR', 'GBP']),
  cadence: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).nullable().describe('null for one-off orders'),
  previousAmount: z.number().nullable().describe('old price, only when the email announces a price increase'),
  deadline: z.string().nullable().describe('YYYY-MM-DD: trial end, return-by date, next renewal, or the date a price change takes effect'),
  itemName: z.string().nullable().describe('plan name or product name'),
  orderNumber: z.string().nullable(),
  emailDate: z.string().nullable().describe('YYYY-MM-DD the email was sent'),
  snippet: z.string().nullable().describe('the sentence from the email that the deadline or price came from, verbatim'),
});

const Extraction = z.object({ items: z.array(Item) });

const SYSTEM = `You read a person's receipts and account emails and pull out the things that quietly cost them money:
- subscriptions and memberships (including renewal receipts and price-increase notices),
- free trials that will turn into paid plans,
- orders that are still inside a return window.

Rules:
- One item per subscription, trial or order. If several emails are about the same subscription, return one item with the latest price and dates; put the old price in previousAmount when a price went up.
- If one email mentions two separate charges (e.g. an annual fee and monthly dues), return two subscription items.
- Skip orders with no stated or clearly implied return window, marketing emails, and anything that is not a charge.
- Resolve relative dates ("in 3 days", "30 days from delivery") against the email's own date, falling back to today's date.
- Use null for anything the emails don't say. Never invent a price or date.`;

let client;
function getClient() {
  client ??= new Anthropic();
  return client;
}

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.LEAKPROOF_AI === '1');
}

export class ExtractError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

export async function extractWithClaude(text, today) {
  if (!text || !text.trim()) throw new ExtractError('Nothing to scan.', 400);
  if (text.length > MAX_INPUT_CHARS) {
    throw new ExtractError(`That's ${text.length.toLocaleString()} characters; scan at most ${MAX_INPUT_CHARS.toLocaleString()} at a time.`, 413);
  }

  let response;
  try {
    response = await getClient().messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: 'low', format: zodOutputFormat(Extraction) },
      messages: [
        {
          role: 'user',
          content: `Today's date is ${today}.\n\n<emails>\n${text}\n</emails>`,
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new ExtractError('The server has no valid Anthropic credentials.', 503);
    if (error instanceof Anthropic.RateLimitError) throw new ExtractError('AI scan is rate limited. Try again in a minute.', 429);
    if (error instanceof Anthropic.APIError) throw new ExtractError(`AI scan failed (${error.status ?? 'network'}).`, 502);
    throw error;
  }

  if (response.stop_reason === 'refusal') throw new ExtractError('The AI declined to scan this text.', 422);
  if (response.stop_reason === 'max_tokens') throw new ExtractError('Too many emails for one scan. Split them into smaller batches.', 413);
  if (!response.parsed_output) throw new ExtractError('The AI returned an unreadable result.', 502);

  const iso = /^\d{4}-\d{2}-\d{2}$/;
  return response.parsed_output.items.map((item) => ({
    ...item,
    deadline: item.deadline && iso.test(item.deadline) ? item.deadline : null,
    emailDate: item.emailDate && iso.test(item.emailDate) ? item.emailDate : null,
  }));
}

// Minimal JSON API shared by the dev middleware and the production server.
export async function handleApi(req, res) {
  const send = (status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };

  if (req.method === 'GET' && req.url === '/api/status') {
    return send(200, { ai: aiConfigured() });
  }
  if (req.method === 'POST' && req.url === '/api/extract') {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_INPUT_CHARS * 2) return send(413, { error: 'Request too large.' });
    }
    try {
      const { text, today } = JSON.parse(raw || '{}');
      const day = /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10);
      const items = await extractWithClaude(String(text || ''), day);
      return send(200, { items });
    } catch (error) {
      if (error instanceof SyntaxError) return send(400, { error: 'Invalid JSON.' });
      if (error instanceof ExtractError) return send(error.status, { error: error.message });
      console.error(error);
      return send(500, { error: 'Unexpected server error.' });
    }
  }
  return false;
}
