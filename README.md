# BillKhata

Local-first receipt scanner, daily expense tracker and Nepal IRD lucky draw helper.
Live at **https://expense.sagunpradhan.com.np**, deployed to GitHub Pages by
`.github/workflows/deploy.yml` on every push to `main` (`public/CNAME` sets the domain).

Everything runs in the browser. There is no backend: bills and photos live in IndexedDB,
the profile and settings in localStorage, and API keys never leave the device except to
the OCR provider the user picked.

```sh
npm install
npm run dev       # http://localhost:5173
npm test          # date conversion, receipt parser, IRD rules, portal helper
npm run build     # writes dist/
```

The first visit loads seven sample bills (one is an eligible cash bill ready for
"Apply to IRD Lucky Draw") and a demo profile. Settings → Backup & restore removes them.

## Layout

| Path | What it is |
|---|---|
| `src/lib/nepaliDate.js` | BS ⇄ AD conversion and the fortnightly draw window. Uses `bsCalendar.js`, the same month table prize.ird.gov.np ships (BS 2000–2090). |
| `src/lib/ird.js` | Eligibility engine, IRD status, and the portal fill script / bookmarklet. |
| `src/lib/ocr/` | `parse.js` turns Tesseract text into fields; `vision.js` calls Gemini, OpenAI or Claude with the user's key; `index.js` picks the engine. |
| `src/lib/image.js` | Canvas compression to under 300 KB for storage, plus a sharper copy for OCR. |
| `src/lib/db.js`, `profile.js` | IndexedDB (via `idb`) and localStorage. |
| `src/lib/backup.js`, `pdf.js` | JSON backup/restore with validation; jsPDF report with a receipt appendix. |
| `src/lib/sample.js` | Demo bills with canvas-drawn receipts. |
| `src/views/`, `src/components/` | Dashboard, Ledger, Scan, Reports, Settings; bill form, IRD modal, lists. |

## IRD rules

Checked against prize.ird.gov.np's own code (October 2026):

- Manual entry is for **cash** bills only. QR and card payments are entered automatically by the
  bank or wallet; entering them again breaks the program rules. BillKhata shows a badge instead of
  the Apply button for `Digital QR / Card`. `CBMS Big Mart` bills are treated like cash.
- Amount must be **at least Rs. 100** (`>= 100`, as the portal validates). Change `IRD_MIN_AMOUNT`
  in `src/lib/constants.js` if the rule changes.
- Seller PAN must be 9 digits. Business purchases, government bodies, phone/internet/electricity,
  transport and air tickets are excluded.
- Bills dated outside the current fortnight (1–15 or 16–end of the Nepali month) get a warning,
  not a block.

## IRD portal helper (Tampermonkey userscript + bookmarklet)

`src/ird-helper/helper.js` is one plain-JS file that `vite.config.js` builds two ways:

- **`/billkhata-ird.user.js`**: a Tampermonkey userscript (`@match https://prize.ird.gov.np/*`),
  installed from Settings or the Quick-Apply modal. Updates itself from the same URL; bump
  `version` in `package.json` when the helper changes.
- **A bookmarklet** (minified, via the `virtual:ird-helper` module) and a per-bill console script.

Flow: **Open portal & auto-fill** opens `https://prize.ird.gov.np/#billkhata=<base64url bill>`.
The fragment never reaches the server, and the helper removes it from the address bar at once.
One click on **Fill the form** (or on the bookmark) fills all 8 fields: Cash, bill number,
seller PAN, bill date, amount, name, mobile, address. The bill date is a custom calendar with
no input, so the helper opens it, sets the year and month dropdowns, and clicks the day. That
works in the portal's Nepali (BS) and English (AD) modes. Bill numbers are cleaned the way the
portal cleans them (letters, digits, `. / _ -`, upper case; Nepali digits converted). Each field
is checked afterwards and re-filled if it came out empty.

After the user passes the security check and submits, the helper spots the coupon
(`.prize-coupon-card .coupon-numerals`) and offers **Save to BillKhata**, which opens
`#/coupon/<billId>/<code>` in the app for confirmation.

It never touches the hidden `company_website` honeypot, the Turnstile check or the submit
button, and it refuses to fill Fonepay/QR/card bills, which the bank or wallet has already entered.

The portal's CSP is `script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'`.
Tampermonkey, the console and bookmarklets in Chrome, Edge and Firefox are not affected. Safari
may block bookmarklets there, so Tampermonkey (or the Userscripts app) is the route on Safari.

### Fonepay / QR / card bills

Bills paid by Fonepay, eSewa, Khalti, mobile-banking QR or card are entered in the draw by the
payment provider. BillKhata shows **Add coupon** for them: a coupon-only screen explaining where
to find the number in the banking or wallet app. The scanner marks a bill as digital when it
sees Fonepay, eSewa, Khalti, IME Pay, connectIPS or "paid by QR/card".

## Portal form fields

The portal's enrollment form uses `bill_number`, `seller_pan_no`, `billed_total_amount`, `name`,
`mobile_number` and `address` inputs, a Cash / Electronic radio group, and a `.nepali-date-trigger`
calendar for `bill_date` (stored as an AD date). If the portal changes these, update
`src/ird-helper/helper.js` and test it on the live portal without submitting.
