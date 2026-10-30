// Fortnightly winner check and the 15-day claim checklist.
// Rules: Taxpayer Incentive Gift Programme Operating Procedure, 2083 (Sections 6, 8, 9).
import { useState } from 'react';
import { CalendarClock, CircleAlert, ExternalLink, PartyPopper, SearchCheck, Trophy } from 'lucide-react';
import { IRD_PORTAL_URL } from '../lib/constants.js';
import { money } from '../lib/format.js';
import { CLAIM_DAYS, extractCouponCodes, formatCoupon, lastAnnouncementBS, matchWinningCoupons, normalizeCouponCode, PRIZES } from '../lib/ird.js';
import { addDaysAD, adToBs, bsToAd, formatAD, formatBS, todayAD, todayBS } from '../lib/nepaliDate.js';
import { useStore } from '../store.jsx';
import { useToast } from './Toast.jsx';
import { Button, Field, Modal } from './ui.jsx';

const DAY_MS = 86400000;
const daysBetween = (fromAD, toAD) => Math.round((Date.parse(`${toAD}T00:00:00Z`) - Date.parse(`${fromAD}T00:00:00Z`)) / DAY_MS);

/** Claim deadline from the announcement date: 15 days (Section 9(1)). */
export const claimByFor = (announcedAD) => addDaysAD(announcedAD, CLAIM_DAYS);

/** Bills marked as winners whose claim window is still open, soonest deadline first. */
export function openWins(expenses, today = todayAD()) {
  return expenses
    .filter((e) => e.irdWin?.claimByAD && e.irdWin.claimByAD >= today)
    .sort((a, b) => a.irdWin.claimByAD.localeCompare(b.irdWin.claimByAD));
}

const CHECKLIST = [
  ['bill', 'Original paper bill (सक्कल बीजक)', 'The physical bill itself. A photo or screenshot is not accepted at claim time.'],
  ['id', 'Copy of an ID', 'National ID, citizenship certificate, passport, driving licence or another official ID (राष्ट्रिय परिचयपत्र, नागरिकता, राहदानी, सवारी चालक अनुमतिपत्र).'],
  ['bank', 'Bank account details', 'The prize is paid straight into the account you give (Section 9(4)).'],
  ['pan', 'Your PAN (स्थायी लेखा नम्बर)', 'Your personal Permanent Account Number.'],
];

/** Countdown, prize amounts and the documents list for one winning bill. */
export function ClaimChecklist({ bill }) {
  const { saveExpense, profile } = useStore();
  const win = bill.irdWin || {};
  const checks = win.checklist || {};
  const today = todayAD();
  const left = win.claimByAD ? daysBetween(today, win.claimByAD) : null;

  async function toggle(key) {
    await saveExpense({ ...bill, irdWin: { ...win, checklist: { ...checks, [key]: !checks[key] } } });
  }

  return (
    <div className="space-y-4">
      <div className={`flex items-start gap-3 rounded-xl p-4 ${left != null && left <= 3 ? 'bg-red-50 text-red-950 ring-1 ring-red-200' : 'bg-amber-50 text-amber-950 ring-1 ring-amber-200'}`}>
        <CalendarClock className="mt-0.5 size-5 shrink-0" />
        <div className="text-sm">
          <p className="font-bold">
            Claim by {formatAD(win.claimByAD)}{win.claimByAD ? ` (${formatBS(adToBs(win.claimByAD))} BS)` : ''}
            {left != null && (left < 0 ? ' · window closed' : left === 0 ? ' · last day today' : ` · ${left} day${left === 1 ? '' : 's'} left`)}
          </p>
          <p className="mt-0.5">
            Within {CLAIM_DAYS} days of the announcement on {formatAD(win.announcedAD)}, apply at your nearest Inland Revenue Office, yourself or through a representative (Section 9(1)).
            Unclaimed prizes go to the Prime Minister’s Disaster Relief Fund (Section 9(5)).
          </p>
          <p className="mt-1">
            prize.ird.gov.np also has an online claim form. Its winners list shows the exact “Claim available until” date for your coupon; trust that date over this estimate.
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {CHECKLIST.map(([key, title, note]) => (
          <li key={key}>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
              <input type="checkbox" className="mt-1 size-4 accent-emerald-700" checked={Boolean(checks[key])} onChange={() => toggle(key)} />
              <span className="text-sm">
                <span className={`block font-semibold ${checks[key] ? 'text-emerald-800 line-through decoration-emerald-700/50' : 'text-slate-900'}`}>{title}</span>
                <span className="text-slate-600">{note}</span>
                {key === 'pan' && (profile.pan ? <span className="mt-0.5 block font-mono text-slate-800">Saved in BillKhata: {profile.pan}</span> : <a href="#/settings" className="mt-0.5 block font-semibold text-navy underline">Add your PAN in Settings</a>)}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
        <b className="text-slate-800">Prize amounts (Section 8):</b> daily prize {money(PRIZES.daily.gross)} ({money(PRIZES.daily.net)} after 25% tax);
        fortnightly bumper {money(PRIZES.bumper.gross)} ({money(PRIZES.bumper.net)} after tax). Tax is withheld under Section 88A of the Income Tax Act, 2058.
        The office checks the documents and pays within 10 days (Section 9(2)).
      </div>
      <a href={IRD_PORTAL_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy underline">
        <ExternalLink className="size-4" />Open prize.ird.gov.np
      </a>
    </div>
  );
}

function WinnerCard({ bill }) {
  const { profile, openPhoto } = useStore();
  return (
    <div className="overflow-hidden rounded-xl border-2 border-emerald-400 bg-white">
      <div className="flex items-center gap-2 bg-emerald-600 px-4 py-2.5 font-bold text-white">
        <Trophy className="size-5" />Winning coupon <span className="ml-auto font-mono tracking-wider">{formatCoupon(bill.irdCoupon)}</span>
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-[160px_minmax(0,1fr)]">
        {bill.receiptImage ? (
          <button type="button" onClick={() => openPhoto(bill)} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50" aria-label="View the bill photo">
            <img src={bill.receiptImage} alt={`Bill from ${bill.merchantName}`} className="max-h-56 w-full object-contain" />
          </button>
        ) : <div className="flex h-32 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-500">No photo saved</div>}
        <div className="min-w-0">
          <p className="text-lg font-bold text-slate-900">{bill.merchantName}</p>
          <p className="text-sm text-slate-600">
            Bill {bill.invoiceNumber || '—'} · PAN {bill.sellerPan || '—'} · {formatAD(bill.billDateAD)}{bill.billDateBS ? ` (${formatBS(bill.billDateBS)})` : ''} · <span className="num font-semibold text-slate-900">{money(bill.totalAmount, profile.region)}</span>
          </p>
          <p className="mt-2 flex gap-1.5 text-sm font-semibold text-red-800"><CircleAlert className="mt-0.5 size-4 shrink-0" />Find the original paper bill now: you can’t claim without it.</p>
        </div>
      </div>
      <div className="border-t border-slate-200 p-4"><ClaimChecklist bill={bill} /></div>
    </div>
  );
}

/** Paste a winners list, find your coupons in it, and get the claim checklist. */
export function WinnerCheckModal({ onClose, initial = [] }) {
  const { expenses, saveExpense } = useStore();
  const toast = useToast();
  const [text, setText] = useState('');
  const [announcedBS, setAnnouncedBS] = useState(lastAnnouncementBS(todayBS()));
  const [result, setResult] = useState(initial.length ? { codes: null, ids: initial.map((b) => b.id) } : null);
  const saved = expenses.filter((e) => normalizeCouponCode(e.irdCoupon));
  const announcedAD = bsToAd(announcedBS) || todayAD();

  async function check() {
    const codes = extractCouponCodes(text);
    const wins = matchWinningCoupons(text, expenses);
    for (const b of wins) {
      const code = normalizeCouponCode(b.irdCoupon);
      // Keep the first recorded announcement for a coupon; don't move its deadline later.
      if (b.irdWin?.code === code) continue;
      await saveExpense({ ...b, irdWin: { code, announcedAD, claimByAD: claimByFor(announcedAD), foundAt: new Date().toISOString(), checklist: {} } });
    }
    setResult({ codes: codes.length, ids: wins.map((b) => b.id) });
    if (wins.length) toast(`Congratulations — ${wins.length} of your coupons won!`);
  }

  const winners = result ? expenses.filter((e) => result.ids.includes(e.id)) : [];

  return (
    <Modal open onClose={onClose} title={initial.length ? 'Claim your prize' : 'Check winning coupons'} size="xl" footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        {!initial.length && (
          <>
            <p className="text-sm text-slate-700">
              Winners are drawn on the 1st and 16th of each Nepali month (Section 6). On <a href={IRD_PORTAL_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-navy underline">prize.ird.gov.np</a>,
              open <b>विजेता सूची</b> (Winners list), select all the text and copy it, or copy an IRD winner notice. Paste it below to check your {saved.length} saved coupon{saved.length === 1 ? '' : 's'}.
            </p>
            <Field label="Winners list text" htmlFor="win-text" hint="Spaced (007 315 254 493), joined (007315254493) or Nepali digits (००७ ३१५ २५४ ४९३) all work.">
              <textarea id="win-text" rows={6} className="input font-mono text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the winners list here" />
            </Field>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Announced on (BS)" htmlFor="win-date" hint={bsToAd(announcedBS) ? `${formatAD(announcedAD)} · claim by ${formatAD(claimByFor(announcedAD))}` : 'YYYY-MM-DD'}>
                <input id="win-date" className="input num w-40" value={announcedBS} onChange={(e) => setAnnouncedBS(e.target.value.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966)).replace(/[^\d-]/g, '').slice(0, 10))} />
              </Field>
              <Button variant="primary" icon={SearchCheck} onClick={check} disabled={!text.trim() || !bsToAd(announcedBS)}>Check my coupons</Button>
            </div>
          </>
        )}

        {result && result.codes != null && (
          <div className={`rounded-lg p-3 text-sm ${winners.length ? 'bg-emerald-50 text-emerald-950' : 'bg-slate-50 text-slate-700'}`}>
            {result.codes === 0
              ? 'No 12-digit coupon numbers found in that text. Copy the whole winners list and try again.'
              : winners.length
                ? <span className="flex items-center gap-2 font-bold"><PartyPopper className="size-5" />{winners.length} of your coupons {winners.length === 1 ? 'is' : 'are'} on this list!</span>
                : `Checked ${result.codes} winning coupon${result.codes === 1 ? '' : 's'} against your ${saved.length} saved coupon${saved.length === 1 ? '' : 's'}: no match this time.`}
          </div>
        )}
        {winners.map((b) => <WinnerCard key={b.id} bill={b} />)}
      </div>
    </Modal>
  );
}
