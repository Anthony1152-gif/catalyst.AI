# Leakproof

**Find the money you're quietly losing, and fix it in one tap.**

People lose money to many small, recurring leaks rather than one big one: subscriptions they forgot about, free trials that turn into paid plans, price rises nobody announced loudly, and return windows that close before they get round to it. Leakproof reads your receipts and account emails, finds those leaks, warns you before each deadline, and writes the email that fixes each one.

```bash
npm install
npm run dev      # http://localhost:5173  (app + API in one process)
npm test         # parser, analysis, merge and draft tests (node:test)
npm run build && npm start   # production server on :8787 (PORT to change)
```

Click **Try the demo inbox** to see it work on sample emails without pasting your own.

## What it does

| Leak | How it's found | The fix it offers |
|---|---|---|
| Forgotten subscriptions | Renewal receipts with a price and billing cycle (weekly, monthly, quarterly or yearly) | A cancellation email and the merchant's cancel/account page |
| Free trials about to convert | "Trial ends on…" or "in 7 days" emails, plus the price after the trial | A "cancel before I'm charged" email. Shown under **Act now** if it converts within 7 days |
| Price increases | "Price changing from $X to $Y" notices | A request to keep the old rate or get a retention offer, with cancellation as the fallback |
| Overlapping services | Two or more active subscriptions in the same category (streaming, music, cloud storage, books) | Each overlapping subscription is flagged with the others it duplicates |
| Annual renewals | A yearly plan renewing within 14 days | Cancel before the renewal charge |
| Return windows | Order emails with "return by" dates or "within 30 days of delivery" | A return and refund request with the order number filled in. The order is hidden once the window closes |

- **Leak meter:** total recurring cost per month and per year, the amount at stake this week, and how much you've saved so far.
- **Done, I cancelled it** adds that item's yearly cost (or the refund amount) to the savings counter. You can undo it.
- **I use this** marks a subscription as kept on purpose, so it no longer counts as a leak.
- Duplicate emails are merged into one item. Three Netflix receipts plus a price notice become one subscription that shows the price rise. A receipt that arrives after a trial turns the trial into a paid subscription.

## Privacy

- **The default scanner runs entirely in the browser.** `src/lib/parser.js` uses pattern matching and needs no network and no API key.
- **Data stays in `localStorage` on your device.** There is no account and no bank login. **Erase all my data** wipes it.
- **AI scan is optional.** It is switched on only when the server has Anthropic credentials. When you use it, the pasted text is sent to the server and then to Claude for that one scan.

## AI scan

Set `ANTHROPIC_API_KEY` before starting the dev or production server, and the **AI scan** toggle turns on automatically. `server/extract.js` sends the pasted emails to `claude-opus-5-5` with a structured-output schema (Zod). It gets back the same item shape the offline parser produces, so everything after the scan works the same either way.

- The AI handles messier emails than the offline parser does, such as two charges in one email or unusual wording.
- If the AI scan fails (no credentials, rate limit, the model declines, or the input is too long), the app says why and falls back to the on-device scanner.
- Input is capped at 150k characters per scan. Longer input is rejected with a message, never silently cut.

## Layout

```
src/lib/parser.js     offline email → item extraction
src/lib/analyze.js    leak meter, urgency, reasons, overlap detection
src/lib/drafts.js     cancellation / return / negotiation emails
src/lib/store.js      localStorage + de-duplicating merge
src/lib/merchants.js  known merchants, categories, cancel pages
src/lib/sample.js     demo inbox (dates relative to today)
src/main.js           UI (vanilla JS, no framework)
server/extract.js     /api/status and /api/extract (Claude)
server/index.js       production static server + API
public/               PWA manifest, service worker, icon
```

## Next steps

- Gmail / Outlook read-only sign-in, so you don't have to paste emails
- Push or email reminders on the morning of each deadline
- Price-drop refunds: watch recent orders and claim the difference
- Cancel pages for more merchants, kept current
