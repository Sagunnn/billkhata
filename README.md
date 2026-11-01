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
npm test          # dates, parser, IRD rules, duplicates, winners, OCR, splitter, trips, QR, voucher codes + PDF, helper, bank
npm run build     # writes dist/
```

The first visit loads seven sample bills (one is an eligible cash bill ready for
"Apply to IRD Lucky Draw") and a demo profile. Saving your own details in Settings removes the
sample bills (and a real profile saved earlier triggers the same clean-up on the next load).
Settings → Backup & restore can load them again on purpose; they're then kept.

## Layout

| Path | What it is |
|---|---|
| `src/lib/nepaliDate.js` | BS ⇄ AD conversion and the fortnightly draw window. Uses `bsCalendar.js`, the same month table prize.ird.gov.np ships (BS 2000–2090). |
| `src/lib/ird.js` | Eligibility engine, IRD status, and the portal fill script / bookmarklet. |
| `src/lib/ocr/` | `paddle.worker.js` + `local.js` run PaddleOCR on the device; `rows.js` turns its boxes into rows; `parse.js` turns text into fields; `vision.js` calls Gemini, OpenAI or Claude with the user's key; `index.js` picks the engine. |
| `src/lib/image.js` | Canvas compression to under 300 KB for storage, plus a sharper copy for OCR. |
| `src/lib/db.js`, `profile.js` | IndexedDB (via `idb`) and localStorage. |
| `src/lib/backup.js`, `pdf.js` | JSON backup/restore with validation; jsPDF report with a receipt appendix. |
| `src/lib/sample.js` | Demo bills with canvas-drawn receipts. |
| `src/lib/bank/` | Bank statements (`statement.js`, `pdfText.js`, `sheet.js` for spreadsheets), payment screenshots (`payment.js`), matching (`reconcile.js`); `importers.js` is the browser side. |
| `src/views/`, `src/components/` | Dashboard, Ledger, Scan, Bank, Reports, Settings; bill form, IRD modal, lists. |

## Mobile, trust and first load

- **Thumb reach:** the raised Scan button in the bottom bar; on the review screen Save is a wide
  button in a one-row bar just above it, and the bill editor puts Save full width on top. Every
  button is at least 44 × 44 px on touch screens (`.tap`).
- **Safe areas:** `viewport-fit=cover` with `env(safe-area-inset-*)` on the header, bottom bar,
  sticky bars, toasts and bottom sheets (sized with `dvh`), so nothing hides behind the notch, the
  home bar or the browser's toolbars.
- **Checking a scan:** the bill photo (pinch, double-tap, drag; Ctrl + scroll and +/− on desktop)
  sticks under the header on phones and folds away to a thin bar; on desktop it stays in view beside
  the form. A badge says **Scanned** (read, not saved), **Verified** (saved) or **Submitted** (IRD
  coupon saved). The PAN field counts digits ("6 of 9") and turns green at 9.
- **Adding a bill:** Scan and Add by hand sit side by side on the Scan page, the Dashboard and the
  sidebar. Upload takes a photo or a **PDF e-bill**: page 1 becomes the bill's photo and, when the
  PDF has a text layer, its exact text goes through the receipt parser instead of OCR
  (`extractBillFromText`). Drop a photo or PDF anywhere on the Scan page, a statement on the Bank
  page's statement box, or several screenshots on its screenshots box; a file dropped anywhere else
  is ignored instead of making the browser leave the app.
- **Shop suggestions:** the shop field lists shops from your saved bills as you type (by name or PAN
  digits; your most-used ones when it's empty). Picking one fills its PAN and category.
- **Medicine** category: pharmacies, medical halls, clinics, hospitals and labs are guessed as
  Medicine. It counts for the IRD draw like any other shop bill.
- **Numbers line up:** tabular figures on amounts, dates, PANs and invoice numbers; each bill row
  is shop and amount on top, then date · BS date · category, then invoice and PAN, in a muted line.
- **IRD copy:** the portal fields in a monospaced box with one Copy button (✓ and a toast), plus
  each field on its own.
- **Saved on this device:** a pill in the mobile header and a note in the sidebar show where bills
  live and when the last backup was downloaded; an amber dot after 14 days without one. Settings has
  JSON backup / restore and a CSV export for spreadsheets (no photos, not restorable).
- **First load:** `index.html` carries a CSS-only skeleton of the app inside `#root`, so there is
  no blank page while the JavaScript loads; React replaces it. With no bills, the Dashboard and
  Ledger offer Scan, Add by hand and Load sample bills.

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

## Voucher codes and the cross-referenced PDF

Every bill gets a short **voucher code** (`src/lib/billCode.js`), shown on the bill form, in the
ledger (searchable) and in the PDF, so it can be written on the paper bill:

- `KT1-03` = Kartik (two-letter BS month: BA JE AS SA BH AW KT MG PS MA FA CH), first fortnight
  (`1` = days 1–15, `2` = 16–end), third bill. Trip bills use the trip's initials: `NW-02` for
  "Nagarkot Weekend".
- Codes are assigned once on save and stored, so a code written on paper stays valid. A bill only
  gets a new code if it moves to another fortnight or into/out of a trip, or if a restore brings in
  a clashing code. Existing bills are coded oldest-first on first load.

The **Expense & Voucher Report** (`buildReportPdf`) puts `Code / Ref` in the first column. With the
receipt appendix on:

- The appendix starts on a new page with up to 4 cards per page (2 × 2). Each card's header shows
  `[KT1-03] - Table ref: page 1, row #4`, then shop · PAN · invoice · amount, and the IRD coupon if
  any. The header links back to the table page.
- After the appendix is drawn, each `Code / Ref` cell gets `-> See p.N` and a link to its card, or
  `No Photo` in grey. Cells are located with autoTable's `didDrawCell`; rows never split across pages.
- `Page X of Y` footers are stamped last, so cross-reference numbers match the visible page numbers.
- Standard PDF fonts have no arrow glyphs, so references use `->` and the card header reads
  "Table ref" instead of `↑`.

## Duplicate & cross-reference engine

`src/lib/dedupe.js` (tests in `src/lib/dedupe.test.js`) checks each bill against every saved bill
in three independent layers, so a torn, cropped or misread scan is still caught:

1. **Bill number.** `normalizeInvoiceStrict` (Nepali digits → ASCII, prefixes like `Bill No` /
   `INV` / `#` removed, separators dropped, leading zeros removed: `00452`, `INV-452` and `०४५२`
   are all `452`). Same number + same seller PAN, or same number + same total when a PAN is
   missing, is an **exact duplicate**. `normalizeInvoiceOCRCanonical` folds OCR look-alikes
   (O/Q/D→0, I/L/|→1, Z→2, S→5, B→8). A look-alike or a one-character difference on the same PAN
   and total is an **OCR look-alike**; the one-character case also needs the same date, because
   consecutive bills from one shop differ by one character too.
2. **Ordered line items** (`buildItemSequenceFingerprints`, 2+ items): the same names and amounts
   top to bottom (`I:momo:180>chilly:250>…`), or the same price sequence (`P:180>250>65>420`)
   with the same total, even when the bill number and PAN are missing.
3. **Photo** (`imageHash` in `image.js`): a 64-bit dHash from a 9 × 8 grayscale grid, compared by
   Hamming distance (≤ 4). Receipts look alike at that size (2 of 78 pairs of *different* test
   receipts were within 4 bits), so a photo match only counts with the same total. Hashes are
   computed on scan and save, and backfilled for older photos.

4. **Same shop, same total, same day** (same PAN, or the same shop name when a PAN is missing),
   only when at least one of the two has no bill number. Two different bill numbers mean two
   real bills. This catches a bill typed in twice, or scanned twice when nothing else read the same.

`crossReferenceBill` returns every match, strongest first. It runs on the Scan screen, the bill
editor (ledger "Add manually" included) and the trip expense form, where it also compares with
the trip's own bills paid by friends, which aren't in your ledger. The bill form shows a
**Cross-Reference Alert Card** ("Already logged as [KT1-07] on 2083-07-13", the reasons, a
side-by-side comparison with both photos) with **View existing bill**, **Discard duplicate scan**
and **Save Anyway (Override)**. Saving is held back until one is chosen; an override is stored on
the bill (`duplicateOverride`). Only the *later* copy is flagged as a copy; from the original, the
card just notes the later copy.

The program allows each bill into the draw once (Operating Procedure 2083, Section 4(6)), so
`findDuplicateBill` (an earlier bill with the same PAN + bill number) keeps IRD auto-fill and
"Save & apply" blocked for the copy, even after an override. The original stays enterable.

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

## OCR: on-device PaddleOCR, VAT check, Vision fallback, merchant memory

- **Engine:** PaddleOCR (PP-OCRv6 tiny, `ppu-paddle-ocr/web` on ONNX Runtime Web) in a Web Worker,
  so reading never freezes the page. Nothing loads with the app: opening the Scan page starts the
  one-time download in the background (skipped with Data Saver on), with a progress bar on the
  first scan. The models (~6.4 MB; the Devanagari model, ~12.7 MB, only with "Read Nepali bills")
  are kept in Cache Storage; ONNX Runtime's `.wasm` is served from this site and uses WebGPU where
  the browser has it. Reads are queued: one ONNX session can't run two at once. Tesseract.js is gone.
- **Preparing the photo** (`prepareForOcr`): tilt measured and straightened (`estimateSkew`: the angle
  at which rows of dark pixels line up most sharply; ppu-ocv's deskew needs OpenCV.js, ~10 MB), no
  side over 2000 px (a 12 MP photo would exhaust a phone's memory; small photos enlarged up to 2×).
  Two copies: `color`, read first and sent to vision models, and `enhanced`
  (`contrastStretchPixels`: grayscale, darkest 5% → black, brightest 15% → white, so faded thermal
  print stands out from grey, shadowed paper). The stored photo is never altered.
- **Boxes → rows** (`rows.js`): Paddle returns one box per run of text with a confidence. The worker
  trims each box to its ink (Paddle pads boxes by about half a line) and measures where each word
  of a multi-word box is (`splitByInk`), because one box can span two table columns. `cleanBoxes`
  drops CJK characters (the multilingual model reads dashed rule lines as 一 三), rule lines and
  boxes under 45% confidence, except plain numbers above 30%. `buildRows` groups boxes whose
  vertical centres are within 0.7 × the text height (a curled bill's amount sits lower than its
  label) and reads each row left to right.
- **Reading a bill:** one read of the colour copy is accepted when it has a printed total and its
  items add up to it (directly, or with 10% service charge and/or 13% VAT). Otherwise the
  contrast-stretched copy is read too, both are also rebuilt from word positions
  (`src/lib/ocr/layout.js`: names and numbers grouped into rows separately, then paired in order),
  and the reads are combined.
- **13% VAT check** (`vatTriplet`): among the amounts in the bottom 60% of the bill, a subtotal, VAT
  and total with subtotal × 13% ≈ VAT and subtotal + VAT ≈ total (within रु 1.5). When it matches
  the bill's total the Scan screen says "Total checked: … + 13% VAT … = …"; a missing or guessed
  total takes the checked one. Totals skip Cash, Tender, Change, Return and Rounding lines.
- **Thermal-print slips** (`fixOcrDigits`): O, Q, D → 0; I, l, | → 1; S → 5; B → 8; Z → 2, only inside a
  number with at least three digits ("6O1234567", "S00.00"), never in a word ("SOUP", "B12").
  Devanagari digits become ASCII first.
- `src/lib/ocr/consensus.js` combines the reads. Totals vote (amount in words 2, a "Grand / Invoice
  Total" line 1.5, a guessed total 0.2). Item rows are matched across reads by amount, name and
  position (a misread "189" joins the "180" row it sits in). The set of rows that adds up to a
  voted total and is backed by the most reads wins. Each row takes the name most reads back, and
  bill number, shop and dates are voted on too. Reading stops early once two reads print the same
  total and every row was seen at least twice.
- Misread digits are fixed with the row's own arithmetic: "90.00 189.09" is 2 × 90 = 180.00,
  "1 200.00 209" is 200. This only happens when the fix is within two characters and 15% of what
  was read.
- Total of a single read: from the "Grand / Net / Invoice Total" line, the **amount in words** ("Six hundred and
  thirty rupees only" → 630, lakh and crore supported) and the sum of the items. A value two of
  them agree on wins, and the amount in words beats a lone total line, because OCR reads words on a
  crumpled bill far better than "630.00". Items larger than the total are dropped. When no total
  is found, the items' sum is used but flagged as a guess (`totalGuessed`): the Scan screen says so
  and offers the Vision re-scan, so a missed item can't hide behind a "matching" total.
- Dates: when a bill's AD date and BS miti disagree (OCR read 2083 as 2073), the one closest to
  today (and not in the future) is kept and the other is derived from it.
- Item rows survive crumpled-bill noise: specks before a name ("EB Chinese Soup Momo") and after the
  amount ("250.00 250.0 7"), qty and rate read as one number ("1200.00 200" = 1 × 200), a price that
  slipped onto the next line ("Coke" / "ol EE 180.00"), and header lines like "Contact No.: 2" or
  "ward 2", and misspelt summary rows ("DisCaunt", "Invoig"). The bill form warns when the items
  don't add up to the total and says by how much. Real reads of a crumpled estimate slip are test
  fixtures (`tests/fixtures/kotheys-*`), including word positions from a tilted copy.
- Estimates ("Estimate", "THIS IS NOT A VALID BILL", "only for accounting purpose", proforma) are
  flagged `isEstimate`. They are saved as expenses but can't enter the IRD draw: the form says to
  ask the shop for its PAN/VAT bill. A missing PAN on an estimate doesn't trigger the Vision prompt.
- Bill numbers: `Bill No.:- 2083/84-1052`, `Invoice # INV-77`, `Inv. No.: KTM/0091`, `बिल नं: ४५७`,
  OCR slips (`lnvoice`, `Bil1`, `N0`) and a number on the next line. The items read from a bill are
  shown, editable, on the bill form.
- After an on-device read with no 9-digit PAN, no total, items that don't add up, or confidence
  below 60, the Scan screen
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

The editor is three steps, built for phones, with Back / Next pinned above the bottom bar:
**1. Bill**: the bill (photo, code, total), then its items as a tidy list; tap an item to edit it.
No items? One tap splits equally. **2. People**: "By what each had" or "Split equally", a − / +
counter, and one line per person: initial (tap to leave out), name (tap to rename), and in by-items
mode a Veg/Non-veg pill and a drinks button. Saved friends and groups sit behind one disclosure.
**3. Shares**: your share / to collect / still owed, then each person's share with Show QR and Mark
paid. **Fine-tune who had what** opens its own window: pick a person from a dropdown (only people
in the split), see the items grouped Veg / Non-veg / Drinks / Shared (a vegetarian's non-veg and a
non-drinker's drinks are folded away), tick what they had, set ×2 for a shared multi-quantity item,
and see who else is on each item. The VAT/service-charge choice is there too. Reopening a split with people
starts on Shares.

- **Line items** come from the scan: `parseLineItemsFromText` for on-device OCR text
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

## Cash & bank (what you have left)

A card on the Dashboard (`src/lib/money.js`, `src/components/CashBank.jsx`). You enter what you
have once ("रु 5,000 cash, रु 40,000 in bank and wallets"), and from then on:

- every bill saved after that moment is taken off: cash bills from **Cash**, QR / wallet / card
  bills from **Bank & wallets** (bills dated earlier are already in the amounts; on the same day,
  only bills added after setting them count). Trip bills count as your share, as on the Dashboard.
- **Money in** is added by hand, with its **source** (Salary, Family, Friend paid back, Refund,
  Business, Interest, or anything typed; sources used before are offered first) and which pot it
  went into. The history shows money in by source.
- **Move** records an ATM withdrawal (bank → cash) or a cash deposit; **No bill** takes off spending
  with nothing to scan (a fare, a tip).
- **History** lists it all with the bills taken off; an entry can be removed. **Set the amounts
  again** starts over from now (old entries are kept in the record).

Kept in localStorage (`billkhata_money`) and in backups. On the Bank page, money in from a
statement shows in green (filter **In**) with **Add to Cash & bank**: salary, refunds and interest
go in as money in with a guessed source; a cash deposit moves cash into the bank. Each row can be
added once; one dated before your starting amounts is already in them, so it can't be added. The
running balance is not shown (it is still used to check each row was read right).

## Bank: spending from statements, payment screenshots, one merged table

`#/bank` (sidebar on desktop, **Bank** on the Ledger page on a phone). Nothing is uploaded: the PDF
and the screenshots are read in the browser and kept in IndexedDB (`statements`, `payments`, DB
version 3), and they're in backups.

- **Statement → ledger** (`parseStatementPages`). pdf.js (the *legacy* build: the modern one needs
  `Uint8Array.toHex`, which older phones lack) gives each text item with its position. Words are
  grouped into lines left to right, following a slight tilt. The column header is found by name
  (`classifyHeader`: Txn/Tran Date, Value Date, Particulars/Narration/Description, Cheque/Ref,
  Withdrawal/Debit, Deposit/Credit, Amount + Dr/Cr, Balance), including two-line headers ("Debit /
  Amount") and names pdf.js glued into one item ("Value Date Particulars", split by
  `splitHeaderCell`). Text belongs to the column it starts in; an amount to the column its right edge
  is in, so right-aligned, centred and left-aligned amounts all land correctly. A row starts at a
  date; lines without one continue the narration. Dates: `29/10/2026`, `29-Oct-26`, `Oct 29, 2026`,
  ISO, with a time, and BS (`2083/07/12` → AD). Day-first unless the statement's own dates say
  otherwise. Without a header (a rough scan), a date starts a row and the last amount is the balance.
- **The balance checks every row**: previous − debit + credit = balance. A debit printed under
  Credit is swapped back, one Amount column gets its side from the balance change, newest-first
  statements are checked oldest-first, and rows that still don't add up are flagged.
- **Locked PDFs** ask for the password (used once, not saved). **Scanned PDFs** (a page with no
  text) are drawn at 2.2× and read with on-device OCR, then go through the same parser. An amount
  under a money column's header belongs to it, and one that mostly lies before the next column's
  header belongs to the column before (right-aligned under a narrow "Dr.").
  **CSV** exports use the same header logic, and so do **spreadsheets** (`.xlsx`, `.xls`, `.ods`,
  and HTML tables saved as `.xls`): SheetJS (from cdn.sheetjs.com, loaded only when a spreadsheet
  is opened) gives each cell's text, date cells are written as `YYYY-MM-DD HH:MM` so day and month
  are never guessed, and the sheet with the most transactions wins (`sheet.js`). Wallet exports
  (eSewa-style: a filter block, `Reference Code | Date Time | Description | Dr. | Cr. | Status |
  Balance | Channel`, a Total row and status counts) work as they are: Status and Channel stay out
  of the description, and failed, cancelled or pending rows are left out with a note.
  A **screenshot** of a statement is read with OCR like a scanned page: two-line headers are
  stacked line by line, a date with a reference in front of it in one cell is still found, and a row
  whose date is cut off is reported instead of guessed. When the header itself is garbled (thick
  borders), each line with a date and amounts is still read: reference before the date, words up to
  the first amount as the description, then Dr / Cr / Balance, with status words set aside. Numbers
  OCR reads with low confidence are kept if they are plainly numbers.
- **Bank or wallet name:** files often don't say whose they are, so the preview asks (eSewa,
  Khalti, Laxmi Sunrise Bank… or anything typed; names used before come first), and a statement
  can be renamed later. The name shows on statement chips, Bank rows, the bill form's match card
  and the ledger tag ("In eSewa · 1 Nov"). Wallet names are only detected near the top of a file,
  so an "ESEWA LOAD" payment doesn't label a bank statement. Only the last 4 digits of the account number are kept.
- **Overlapping statements count once** (`src/lib/bank/overlap.js`). Uploading a statement whose
  dates overlap one already saved for the same account (matched by the last 4 digits and the bank or
  wallet name), or the same transactions in another format (the PDF, then the Excel export, then a
  screenshot), never adds a transaction twice. Rows are compared like a person would, not as text
  (one export cuts the description short, another has no balance): same amount and direction and
  the same transaction ID; or the same day with the same balance after it; or the same day when one
  side has no balance; or up to 2 days apart (transaction vs value date) with exactly the same
  balance. Rows whose balances both exist and differ are never merged, and each saved row matches at
  most one new row, so two real रु 100 payments on one day stay two. The preview says how many rows
  are already saved and from which statement; the merged table applies the same rule to everything
  saved, so duplicates uploaded before this check are counted once too. Removing the earlier
  statement brings the later one's rows back.
- **Payment screenshots** (`parsePaymentText`): Fonepay, eSewa, Khalti, IME Pay, connectIPS and bank
  apps. Label then value on one line or the next: amount (a total beats an amount before a fee;
  balances, charges and cashback are ignored), date and time (12- or 24-hour), paid to, transaction /
  trace ID, remarks, failed or successful, paid or received. Dark-mode screens are inverted first
  (`prepareScreenshot`). The same screenshot twice (photo hash, ID, or amount + date + time) is skipped.
- **Matching** (`reconcile`):
  - bank row ↔ screenshot: same amount and direction, the bank date 1 day before to 4 days after
    the payment (posting delay); the transaction ID in the narration (+60), same day (+20), same
    time (+15) and the shop name in the narration (up to +20, cut-off names like "KOTHEYS PIM" count)
    rank the pairs; strongest first, each used once. Two equal payments the same day with no ID to
    tell them apart are flagged as unsure.
  - a saved bill ↔ that pair (or a lone row/screenshot): same total, or within रु 1 when the shop
    rounded off; same or next day; similar shop name; paid digitally. Money in never gets a bill.
  - **Unlink** and **Link** (to anything with the same amount within a week) are stored as
    `reconOverrides` and always win.
- **The table** shows each payment once with where it was found (Bank / Screenshot / Bill), the
  balance, and why a row needs a look: no bill or screenshot for a bank payment, a screenshot that's
  not on the statement, an unsure pair, a balance that doesn't add up, a screenshot that wasn't fully
  read. **Add bill** opens the bill form filled from the row (shop from the screenshot or narration,
  amount, date, digital), and the new bill joins the row. **Export CSV** writes the merged table.
- **Bills scanned anywhere are cross-referenced** (`bankMatchFor`, `BankMatchCard` on the bill form):
  as soon as a scan has a total and a date it's matched against the statements and screenshots
  (against everything except itself, so a fresh scan and the saved bill get the same answer):
  - found → "Found in your bank statement" with the row and screenshot, and a one-click
    "Paid by: Digital QR / Card" if it was left as Cash;
  - the row already has a **photo-less bill added from the Bank page** → "Use this scan for
    [code]" puts the scan's photo, items, PAN, bill number and dates onto that bill (code, split,
    trip and IRD state kept), so there's one bill, not two; the duplicate warning for that same bill
    is folded into this card, with "Keep both" for a different purchase;
  - a digital bill inside a statement's dates that isn't on it → a quiet note.
  Ledger rows show **In bank · screenshot** for bills that matched (`reconcileAll`, worked out once
  in the store and shared with the Bank page).

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
