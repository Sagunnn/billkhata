// First visit: set up your details (for the IRD form), optionally your money, a short tour, and what
// to do with the sample bills. Opened by App on a first visit (or from the demo banner on Home at a
// given step) as the 'welcome' sheet. Shown once: billkhata_welcome = 'done' | 'exploring'.
import { useState } from 'react';
import {
  ArrowRight, Banknote, Check, Landmark, Lock, Luggage, Plus, ReceiptText, ScanLine, ShieldCheck, Sparkles, Ticket, Trash, Wallet, WifiOff, Zap,
} from 'lucide-react';
import { REGIONS } from '../lib/constants.js';
import { ACCOUNT_SUGGESTIONS, kindForName, setAccounts } from '../lib/money.js';
import { flag, validateProfile } from '../lib/profile.js';
import { isInstalled } from '../lib/offline.js';
import { isDemoProfile, useStore } from '../store.jsx';
import { LogoMark } from './Brand.jsx';
import { useToast } from './Toast.jsx';
import { Button, Field } from './ui.jsx';

const KEY = 'billkhata_welcome';
export const welcomeState = () => { try { return localStorage.getItem(KEY) || ''; } catch { return 'done'; } };
const setWelcome = (v) => { try { localStorage.setItem(KEY, v); } catch { /* ignore */ } };

/** A first visit: no welcome yet, the demo profile, and nothing of your own saved. */
export function needsWelcome({ profile, expenses, ready }) {
  return ready && !welcomeState() && isDemoProfile(profile) && !expenses.some((e) => !e.isSample);
}

const TOUR = [
  [ScanLine, 'Scan a bill', 'Point the camera at the bill and tap the button. BillKhata reads the shop, PAN, date and total; check each part against the photo, then save.'],
  [Zap, 'Quick expense', 'A fare, snacks, a tip: no bill needed. The amount, what it was for, done. On Home, the Ledger, or Q on a computer.'],
  [Wallet, 'Your money', 'Cash, bank and wallets, kept up to date as you save bills. Upload a statement and each payment is matched with its bill; moving money between your own accounts isn’t counted twice.'],
  [Luggage, 'Split and trips', 'Split a bill by who had what, or keep a whole trip with friends: scan or add as you go, then settle in the fewest payments.'],
  [Ticket, 'IRD lucky draw', 'Cash bills with a PAN can enter Nepal’s prize coupon draw. BillKhata fills the IRD form for you and keeps your coupon numbers.'],
  [WifiOff, 'Yours, and offline', 'Everything stays on this phone, never uploaded, and works without internet. Download a backup now and then from Settings.'],
];

function Dots({ n, at }) {
  return (
    <div className="flex justify-center gap-1.5" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <span key={i} className={`h-1.5 rounded-full transition-all ${i === at ? 'w-5 bg-brand' : 'w-1.5 bg-line-strong'}`} />)}
    </div>
  );
}

export function WelcomeSheet({ onClose, step: first = 'hello' }) {
  const { profile, setProfile, expenses, money, setMoney, removeSamples, openSheet } = useStore();
  const toast = useToast();
  const [step, setStep] = useState(first);
  const [p, setP] = useState(() => (isDemoProfile(profile) ? { ...profile, fullName: '', phone: '', address: '' } : profile));
  const [errors, setErrors] = useState({});
  const [rows, setRows] = useState([{ name: 'Cash in hand', kind: 'cash', start: '' }, { name: 'eSewa', kind: 'wallet', start: '' }]);
  const [tour, setTour] = useState(0);
  const samples = expenses.filter((e) => e.isSample).length;
  const steps = ['details', 'money', 'tour', 'samples'];
  const at = steps.indexOf(step);

  function finish(state) {
    setWelcome(state);
    onClose();
  }
  async function saveDetails() {
    const errs = validateProfile(p);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    flag('keepSamples', true); // the last step decides what happens to the sample bills
    await setProfile({ ...p, fullName: p.fullName.trim(), address: p.address.trim(), phone: p.phone.trim() });
    setStep('money');
  }
  function saveMoney() {
    const list = rows.filter((r) => r.name.trim() && r.start !== '');
    if (list.length) {
      setMoney((m) => setAccounts(m, list.map((r) => ({ ...r, start: Number(r.start) || 0 }))));
      toast('Accounts set. Bills you save from now on come off them.');
    }
    setStep('tour');
  }
  async function samplesChoice(keep) {
    if (!keep) {
      const n = await removeSamples();
      toast(n ? `Sample bills cleared: your ledger starts empty.` : 'Your ledger starts empty.');
    } else {
      flag('keepSamples', true);
      toast('Sample bills kept. Remove them any time from Home or Settings.');
    }
    setWelcome('done');
    setStep('done');
  }

  const shell = (children, footer) => (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-[#1c170f]/55 md:items-center md:p-6" role="dialog" aria-modal="true" aria-label="Welcome to BillKhata">
      <div className="sheet-max flex w-full max-w-lg flex-col rounded-t-2xl bg-surface shadow-lg md:rounded-2xl">
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-5">
          {at >= 0 && step !== 'tour' && <div className="mb-4"><Dots n={steps.length} at={at} /></div>}
          {children}
        </div>
        {footer && <div className="pb-safe-3 border-t border-line px-5 pt-3">{footer}</div>}
      </div>
    </div>
  );

  if (step === 'hello') {
    return shell(
      <div className="flex flex-col items-center text-center">
        <LogoMark size={64} />
        <h2 className="t-h-l mt-4 text-ink">Namaste! Welcome to BillKhata</h2>
        <p className="t-body mt-2 text-ink-2">Your bills, expenses, money and trips in one place, and your cash bills in the IRD lucky draw.</p>
        <p className="t-label mt-3 flex items-center gap-1.5 rounded-full bg-leaf-soft px-3 py-1.5 text-leaf"><ShieldCheck className="size-4" />Everything stays on this phone. Nothing is uploaded.</p>
        <p className="t-label mt-4 text-ink-3">Two minutes to set up: your details, your money (optional), and a quick look at what it does.</p>
      </div>,
      <div className="grid gap-2">
        <Button variant="primary" size="lg" icon={ArrowRight} onClick={() => setStep('details')}>Set up my account</Button>
        <Button variant="ghost" icon={Sparkles} onClick={() => { finish('exploring'); toast('Look around with the sample bills. Set up your account from the banner on Home when you’re ready.'); }}>Look around with sample bills first</Button>
        <button type="button" onClick={() => { finish('done'); window.location.hash = '#/settings?backup'; }} className="t-label py-1 font-medium text-ink-2 underline">
          Used BillKhata before? Restore a backup
        </button>
      </div>,
    );
  }

  if (step === 'details') {
    const set = (k) => (e) => setP({ ...p, [k]: e.target.value });
    return shell(
      <form onSubmit={(e) => { e.preventDefault(); saveDetails(); }} className="space-y-4">
        <div>
          <h2 className="t-h-m text-ink">Your details</h2>
          <p className="t-label mt-1 text-ink-2">BillKhata fills the IRD lucky draw form with these, so each cash bill takes one tap to enter. They stay on this phone.</p>
        </div>
        <Field label="Full name" htmlFor="w-name" error={errors.fullName}>
          <input id="w-name" className={`input ${errors.fullName ? 'input-error' : ''}`} value={p.fullName} onChange={set('fullName')} autoComplete="name" maxLength={120} autoFocus placeholder="As on your citizenship" />
        </Field>
        <Field label="Mobile number" htmlFor="w-phone" error={errors.phone} hint="The IRD sends your coupon to it">
          <input id="w-phone" inputMode="tel" className={`input num ${errors.phone ? 'input-error' : ''}`} value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} autoComplete="tel" placeholder="98XXXXXXXX" />
        </Field>
        <Field label="Address" htmlFor="w-addr" error={errors.address}>
          <input id="w-addr" className={`input ${errors.address ? 'input-error' : ''}`} value={p.address} onChange={set('address')} autoComplete="street-address" maxLength={250} placeholder="e.g. Baneshwor-10, Kathmandu" />
        </Field>
        <label className="t-label flex items-center gap-2 text-ink-2">
          <input type="checkbox" checked={p.region !== REGIONS.INTL} onChange={(e) => setP({ ...p, region: e.target.checked ? REGIONS.NEPAL : REGIONS.INTL })} className="size-4 accent-[#b91c1c]" />
          My bills are from Nepal (रु, Nepali dates, the IRD draw)
        </label>
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">Next</button>
      </form>,
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={() => setStep('money')}>Skip</Button>
        <Button variant="primary" size="lg" className="flex-1" icon={ArrowRight} onClick={saveDetails}>Next</Button>
      </div>,
    );
  }

  if (step === 'money') {
    const set = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    const missing = ACCOUNT_SUGGESTIONS.filter((n) => !rows.some((r) => r.name.toLowerCase() === n.toLowerCase())).slice(0, 4);
    return shell(
      <div className="space-y-4">
        <div>
          <h2 className="t-h-m text-ink">What do you have now? <span className="t-label font-normal text-ink-3">(optional)</span></h2>
          <p className="t-label mt-1 text-ink-2">Count your cash and check your bank and wallet apps. Every bill you save then comes off the right one, so you always know what’s left.</p>
        </div>
        <ul className="space-y-2">
          {rows.map((r, i) => {
            const Icon = r.kind === 'cash' ? Banknote : r.kind === 'wallet' ? Wallet : Landmark;
            return (
              <li key={i} className="flex items-center gap-2 rounded-[14px] border border-line bg-surface p-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-sunken"><Icon className="size-[18px] text-ink-2" /></span>
                <input aria-label="Account name" className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-ink focus:outline-none" value={r.name} disabled={r.kind === 'cash'}
                  onChange={(e) => set(i, { name: e.target.value, kind: kindForName(e.target.value) })} placeholder="Bank or wallet" />
                <span className="font-nepali text-[15px] text-ink-3">रु</span>
                <input aria-label={`${r.name || 'Account'} amount`} inputMode="decimal" className="num w-24 rounded-[10px] border border-line-strong bg-raised px-2 py-1.5 text-right text-[15px] text-ink focus:border-navy focus:outline-none"
                  value={r.start} onChange={(e) => set(i, { start: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" />
                {r.kind !== 'cash'
                  ? <button type="button" aria-label={`Remove ${r.name}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="tap flex size-8 shrink-0 items-center justify-center rounded-full text-ink-3 hover:text-danger"><Trash className="size-4" /></button>
                  : <span className="tap flex size-8 shrink-0 items-center justify-center text-ink-3" title="Cash in hand is always here"><Lock className="size-3.5" /></span>}
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap gap-2">
          {missing.map((n) => <button key={n} type="button" className="chip tap" onClick={() => setRows((r) => [...r, { name: n, kind: kindForName(n), start: '' }])}><Plus className="size-4" />{n}</button>)}
          <button type="button" className="chip tap" onClick={() => setRows((r) => [...r, { name: '', kind: 'bank', start: '' }])}><Plus className="size-4" />Other</button>
        </div>
        {money.since && <p className="t-caption text-ink-3">You already set your accounts; saving here starts them over from today.</p>}
      </div>,
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={() => setStep('tour')}>Later</Button>
        <Button variant="primary" size="lg" className="flex-1" icon={ArrowRight} onClick={saveMoney}>Next</Button>
      </div>,
    );
  }

  if (step === 'tour') {
    const [Icon, title, text] = TOUR[tour];
    const last = tour === TOUR.length - 1;
    return shell(
      <div className="flex min-h-[18rem] flex-col items-center text-center">
        <p className="t-overline text-ink-3">How it works · {tour + 1} of {TOUR.length}</p>
        <span className="mt-5 flex size-16 items-center justify-center rounded-[20px] bg-brand-soft text-brand"><Icon className="size-8" /></span>
        <h2 className="t-h-m mt-4 text-ink">{title}</h2>
        <p className="t-body mt-2 max-w-sm text-ink-2">{text}</p>
        <div className="mt-auto pt-6"><Dots n={TOUR.length} at={tour} /></div>
      </div>,
      <div className="flex items-center gap-2">
        {tour > 0 ? <Button variant="ghost" onClick={() => setTour(tour - 1)}>Back</Button> : <Button variant="ghost" onClick={() => setStep(samples ? 'samples' : 'done')}>Skip</Button>}
        <Button variant="primary" size="lg" className="flex-1" icon={ArrowRight} onClick={() => (last ? setStep(samples ? 'samples' : 'done') : setTour(tour + 1))}>Next</Button>
      </div>,
    );
  }

  if (step === 'samples') {
    return shell(
      <div className="space-y-3">
        <span className="flex size-12 items-center justify-center rounded-[14px] bg-marigold-soft text-marigold-ink"><ReceiptText className="size-6" /></span>
        <h2 className="t-h-m text-ink">The {samples} sample bills</h2>
        <p className="t-body text-ink-2">They show how a scanned bill, a QR payment, a coupon and the lucky draw look. Keep them to try things out, or start with an empty ledger for your own bills.</p>
        <p className="t-caption text-ink-3">Kept samples are marked, never counted in your money, and can be removed any time from Home or Settings.</p>
      </div>,
      <div className="grid gap-2">
        <Button variant="primary" size="lg" icon={Check} onClick={() => samplesChoice(false)}>Start fresh</Button>
        <Button variant="ghost" onClick={() => samplesChoice(true)}>Keep the samples for now</Button>
      </div>,
    );
  }

  // done (no samples to decide on)
  return shell(
    <div className="flex flex-col items-center text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-leaf-soft text-leaf"><Check className="size-7" /></span>
      <h2 className="t-h-m mt-4 text-ink">You’re set</h2>
      <p className="t-body mt-2 text-ink-2">Scan your first bill, or add a quick expense.</p>
    </div>,
    <div className="grid gap-2">
      <Button variant="primary" size="lg" icon={ScanLine} onClick={() => { finish('done'); window.location.hash = '#/scan'; }}>Scan my first bill</Button>
      <Button variant="ghost" onClick={() => finish('done')}>Go to Home</Button>
      {!isInstalled() && <button type="button" onClick={() => { setWelcome('done'); openSheet('install'); }} className="t-label mt-1 font-medium text-brand">Add BillKhata to your home screen</button>}
    </div>,
  );
}
