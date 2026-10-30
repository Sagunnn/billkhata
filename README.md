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
npm test          # dates, receipt parser, IRD rules, duplicates, winners, OCR preprocessing, portal helper
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
  in `src/lib/constants.js` if the rule changes. A bill of exactly Rs. 100 gets a soft warning:
  Section 4(1) of the Operating Procedure says "एक पटकमा रु. १०० भन्दा बढी" (more than Rs. 100),
  so it may fail at claim time even though the portal accepts it.
- Seller PAN must be 9 digits. Business purchases, government bodies, phone/internet/electricity,
  transport and air tickets are excluded.
- Bills dated outside the current fortnight (1–15 or 16–end of the Nepali month) get a warning,
  not a block.

Rules are cited from the signed *करदाता प्रोत्साहन उपहार कार्यक्रम सञ्चालन कार्यविधि, २०८३*
([ird.gov.np](https://ird.gov.np/content/13584/taxpayer-incentive-gift-program-operating-procedures--2083/)).

## Duplicate bill guard

A bill may enter the draw only once (Section 4(6)); a second entry can void the coupon.
`findDuplicateBill(candidate, bills)` in `src/lib/ird.js` matches another saved bill with the same
9-digit seller PAN and the same bill number after `normalizeInvoiceNumber` (Nepali digits to ASCII,
upper case, only `A-Z 0-9 . / _ -`, the way the portal stores it). The bill form shows a banner
with **Open that bill**, and the Quick-Apply modal blocks **Open portal & auto-fill** (and the
console script) for the copy. Saving is still allowed so nothing is lost.

## Winning coupons and the 15-day claim

Winners are drawn on the 1st and 16th of each Nepali month (Section 6): one per day plus a
fortnightly bumper. Prizes are Rs. 1,33,334 (Rs. 1,00,000 after the 25% windfall tax under
Section 88A of the Income Tax Act, 2058) and Rs. 10,00,000 (Rs. 7,50,000 net) (Section 8).

**Dashboard → Check winning coupons**: paste the text of prize.ird.gov.np's विजेता सूची
(Winners list) or an IRD notice. `matchWinningCoupons(text, bills)` converts Nepali digits and
finds every 12-digit number (`007 315 254 493`, `007315254493`, `0073-1525-4493`; longer digit runs
such as account numbers are skipped), then compares them with saved coupons
(`normalizeCouponCode`). A match is stored on the bill as `irdWin` (announcement date, claim-by
date, checklist ticks), so it is kept in backups and shows as a banner on the dashboard.

Section 9(1): claim **within 15 days of the announcement** at the nearest Inland Revenue Office,
in person or through a representative, with the **original paper bill**, a copy of an ID
(national ID, citizenship, passport or driving licence), bank account details and your PAN.
Unclaimed prizes go to the Prime Minister's Disaster Relief Fund (Section 9(5)). The portal also
has an online claim form and shows each winner's exact "Claim available until" date, which
BillKhata tells the user to trust over its own estimate (announcement date + 15 days).

## OCR: contrast preprocessing, Vision fallback, merchant memory

- `prepareForOcr` makes two 2200 px copies: a colour one for vision models and an enhanced one for
  Tesseract (`preprocessCanvasForOCR`: Rec. 601 luminance grayscale, contrast ×1.45 around mid-grey).
  This helps faded thermal print and carbon-copy handwriting. The stored photo (< 300 KB, colour)
  is never altered.
- After a Tesseract read with no 9-digit PAN, no total, or confidence below 60, the Scan screen
  offers **Re-scan with Vision AI** if any vision API key is saved. It reuses the same image, so there
  is no re-upload.
- `src/lib/merchants.js` remembers shops from earlier bills. A known PAN fills the name and the
  category picked last time, a known name fills the PAN, and the shop field autocompletes.

## Cash vs digital

The dashboard shows this month's cash spend (enter on the portal yourself; CBMS counted here),
digital QR/card spend (entered automatically) and total VAT paid on bills with VAT recorded.

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
(`.prize-coupon-card .coupon-numerals`): a MutationObserver, plus a 400 ms poll for 5 s after the
form's `submit` event in case a slow animation slips past it. It offers
**Save 208 307 123 456 to BillKhata**, which opens `#/coupon/<billId>/<12 digits>` in the app
for confirmation. Field values go through the native `value` setter followed by `input`, `change`
and `blur` events (sent by hand when a background tab can't take focus).

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
