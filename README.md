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
npm test          # dates, receipt parser, IRD rules, duplicates, winners, OCR, splitter, trips, QR, portal helper
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

- `prepareForOcr` makes two copies at 2200 px on the long side (small photos are enlarged up to
  2.5×): a colour one for vision models and an enhanced one for Tesseract (`preprocessCanvasForOCR`:
  Rec. 601 grayscale, then auto-levels: darkest 1% → black, brightest 2% → white, gamma 1.3). It
  adapts to each photo's lighting. On a grey, blurred test photo it recovered the PAN line, the full
  bill number and clean item names, which a fixed ×1.45 contrast stretch lost. The stored photo
  (< 300 KB, colour) is never altered.
- Tesseract reads in page-segmentation mode 6 (one uniform block), which keeps
  "item … qty … rate … amount" on one line; the default auto mode split the same photo into columns
  and lost every item row. If mode 6 finds neither items nor a total, it retries in mode 4 and
  keeps the better read.
- Bill numbers: `Bill No.:- 2083/84-1052`, `Invoice # INV-77`, `Inv. No.: KTM/0091`, `बिल नं: ४५७`,
  OCR slips (`lnvoice`, `Bil1`, `N0`) and a number on the next line. The items read from a bill are
  shown, editable, on the bill form.
- After a Tesseract read with no 9-digit PAN, no total, or confidence below 60, the Scan screen
  offers **Re-scan with Vision AI** if any vision API key is saved. It reuses the same image, so there
  is no re-upload.
- `src/lib/merchants.js` remembers shops from earlier bills. A known PAN fills the name and the
  category picked last time, a known name fills the PAN, and the shop field autocompletes.

## Cash vs digital

The dashboard shows this month's cash spend (enter on the portal yourself; CBMS counted here),
digital QR/card spend (entered automatically) and total VAT paid on bills with VAT recorded.

## Split Khata (bill splitter)

`#/split` lists splits and bills to split; `#/split-bill/<billId>` is the editor. All logic is in
`src/lib/splitter.js` (pure, unit-tested).

- **Line items** come from the scan: `parseLineItemsFromText` for Tesseract text
  ("Chicken Momo 2 250 500", "Tuborg 2 x 450 900", "3 Masala Tea 150"; totals/VAT rows skipped)
  and a `lineItems` array in the Vision schema. Items can be added, edited, deleted, pasted as text
  or read again from the stored photo.
- **`classifyFoodItem`** tags each item `veg`, `non-veg`, `alcohol` or `shared` from Nepali menu
  words (sekuwa, choila, sukuti, kukhurako, khasi, buff…; Tuborg, Gorkha, Barasinghe, Khukuri,
  aila, chhyang…; English and Devanagari). Word boundaries keep "drumstick", "ginger", "eggplant"
  and "buffet" out of the wrong bucket. Unknown food is veg.
- **People** have Veg/Non-veg and Drinks toggles, and **In split / Left out** (a left-out person
  stays listed with Rs. 0, e.g. the payer treating friends). Friends and groups are remembered in
  localStorage. Auto-ticks: veg and shared items to everyone, non-veg to non-veg eaters, alcohol to
  drinkers. Any tick can be changed; an item can switch to **By units (1x, 2x)**.
- **Shares**: **By items**: each item divides among its ticks by weight; the gap to the bill total
  (VAT, service charge, discount) is spread **proportionally** (`subtotal × total / items subtotal`)
  or **equally**. **Split equally**: total ÷ people in the split. Rounded to the paisa
  (largest remainder) so shares add up exactly; unassigned items are reported, never charged.
- **Ledger**: the bill keeps its full amount (for the IRD draw); `expense.split` stores the state,
  `myShare`, `recoverable` and `outstanding` (unpaid friends). Reports and the PDF show them.
- **Payment QR** (Settings): an eSewa personal QR built from the profile
  (`{"eSewa_id":"…","name":"…"}`; eSewa doesn't publish its format, so check it with the eSewa app),
  or an uploaded bank / Fonepay / eSewa / Khalti QR, cropped, kept under 100 KB and read with jsQR.
- **Amounts aren't put into the QR.** eSewa and Nepali banking apps ignored an amount added to a
  personal QR when tested (real fixed-amount QRs are issued by Fonepay / NEPALPAY servers), so each
  person's **QR** button and the summary image show the payer's QR **exactly as uploaded**, with the
  amount large and a copy button. `src/lib/emvqr.js` parses and checks NepalQR / EMVCo codes
  (CRC-16/CCITT-FALSE, verified against the EMVCo specification's worked example) to flag a misread
  QR, and keeps a tested `buildDynamicNepalQR` (tag 01 → `12`, tag 54 amount, new tag 63 CRC) that
  the UI doesn't use.
- **Sharing is local only.** The summary PNG (canvas) is made on the device and goes wherever the user
  sends it. **Split links are switched off**: a page on this domain would show whatever payment QR a
  `#/split/<token>` link carried, and a link can't prove who made it, so a forged one could show
  someone else's QR. Old or crafted links land on a "links are turned off" notice that shows nothing
  from the link. The tested encode/decode helpers (`encodeSplit`, `decodeSplit`, `sharePayload`)
  stay for a future signed-link version.

## Trip Khata (group trips, many payers)

`#/trips` lists trips; `#/trip/<id>` is one trip. Logic is in `src/lib/trips.js` (pure, unit-tested).
Trips live in their own IndexedDB store (`trips`, added in DB version 2). The upgrade only creates
what's missing, so existing bills are kept.

- **Expenses** are either a bill (scan/upload: shop, PAN, invoice, total, VAT and items are read) or
  a no-bill cash payment (taxi, fuel, snacks, tickets), each with **who paid**. A no-bill expense is
  one line; any expense can be split into items. Bills can also be added from the ledger.
- **`classifyTripItem`**: `shared` (taxi, Pathao, fuel, hotel/room, tickets, toll, parking, water),
  `non-veg` (sekuwa, choila, sukuti, pangra, egg…), `drink` (beer, rum, coke, tea, coffee, lassi,
  juice…) or `veg`. **`getDefaultAssignedMembers`** ticks non-veg for non-vegetarians, drinks for
  people with Drinks on, veg and shared for everyone (or "Veg members only"). Any tick can change.
- **Shares** (`entryShares`): each item split equally among its ticks (nobody ticked → everyone,
  with a warning); VAT / service charge / discount spread in proportion to each person's items;
  rounded to the paisa so each expense adds up exactly. Per person: veg, non-veg, drinks, shared,
  tax.
- **Settlement** (`calculateTripSettlement`, `simplifyDebts`): paid − consumed = balance; the largest
  debtor pays the largest creditor until done (balances within Rs. 0.50 count as even). At most
  N − 1 payments. Each payment shows the receiver's own QR (theirs, uploaded or pasted, or yours from
  Settings) with the amount and a copy button, and can be marked paid.
- **Ledger / IRD**: a bill *you* paid is also saved in your ledger (so you can enter it in the IRD
  draw) with `excludeFromSpend`, so it isn't counted as spending. **Log My Final Trip Share** adds
  your real consumption as one ledger expense (`trip-share-<tripId>`, updatable). A bill someone
  else paid stays only in the trip; they hold the paper bill.
- **Trip PDF** (who pays whom, each person's breakdown, every expense with its items) and trips in the
  JSON **backup / restore** (merge by id, or overwrite).
- No trip share links, for the same reason as Split Khata.

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
