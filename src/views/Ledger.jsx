// Ledger (Figma: Phone 03 · Ledger): every bill, grouped by Nepali day with the day's total, a
// search, range chips (this Nepali month among them), and filters for category, payment and IRD.
import { useEffect, useRef, useState } from 'react';
import { Download, RotateCcw, ScanLine, Search, SlidersHorizontal, Zap } from 'lucide-react';
import { CATEGORIES, IRD_STATUSES, PAYMENT_METHODS } from '../lib/constants.js';
import { filterExpenses, reportTotals } from '../lib/expense.js';
import { money } from '../lib/format.js';
import { BS_MONTHS, addDaysAD, parseYmd, shortBS, todayAD, todayBS } from '../lib/nepaliDate.js';
import { useStore } from '../store.jsx';
import { BillCards, BillTable } from '../components/BillCard.jsx';
import { NoBillsYet } from '../components/NoBillsYet.jsx';
import { Button, Card, Chip, EmptyState, Field, Modal } from '../components/ui.jsx';

const EMPTY = { range: 'all', from: '', to: '', category: '', payment: '', status: '', search: '' };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function readFilters() {
  try {
    return { ...EMPTY, ...JSON.parse(sessionStorage.getItem('billkhata_filters') || '{}') };
  } catch {
    return EMPTY;
  }
}

/** "TODAY · 16 KARTIK", "SATURDAY · 15 KARTIK". */
function dayHeading(ad, today) {
  const day = ad === today ? 'Today' : ad === addDaysAD(today, -1) ? 'Yesterday' : WEEKDAYS[new Date(`${ad}T00:00:00Z`).getUTCDay()];
  return ad ? `${day} · ${shortBS(ad)}` : 'No date';
}

const PAGE = 80;

function groupByDay(list) {
  const groups = [];
  for (const e of list) {
    const last = groups.at(-1);
    if (last && last.day === e.billDateAD) last.bills.push(e);
    else groups.push({ day: e.billDateAD, bills: [e] });
  }
  return groups;
}

function FilterSheet({ f, update, onClose }) {
  const [draft, setDraft] = useState(f);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  return (
    <Modal open size="md" title="Filter bills" onClose={onClose}
      footer={<>
        <Button variant="ghost" icon={RotateCcw} onClick={() => { update({ ...EMPTY, search: f.search }); onClose(); }} className="mr-auto">Reset</Button>
        <Button variant="primary" onClick={() => { update(draft); onClose(); }}>Show bills</Button>
      </>}>
      <div className="space-y-4">
        <Field label="Category" htmlFor="lf-cat">
          <select id="lf-cat" className="input" value={draft.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Paid by" htmlFor="lf-pay">
          <select id="lf-pay" className="input" value={draft.payment} onChange={(e) => set({ payment: e.target.value })}>
            <option value="">Any way</option>
            {PAYMENT_METHODS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="IRD lucky draw" htmlFor="lf-ird">
          <select id="lf-ird" className="input" value={draft.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">Any status</option>
            {IRD_STATUSES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <fieldset>
          <legend className="label">Dates</legend>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" className="input" value={draft.from} aria-label="From date" onChange={(e) => set({ from: e.target.value, range: 'custom' })} />
            <input type="date" className="input" value={draft.to} aria-label="To date" onChange={(e) => set({ to: e.target.value, range: 'custom' })} />
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}

const iconBtn = 'tap relative flex size-10 items-center justify-center rounded-full border border-line bg-surface text-ink hover:bg-sunken';

export default function Ledger() {
  const { expenses, openSheet } = useStore();
  const [f, setF] = useState(readFilters);
  const [filtering, setFiltering] = useState(false);
  const searchRef = useRef(null);
  const update = (patch) => {
    const next = { ...f, ...patch };
    setF(next);
    setShown(PAGE); // a new filter starts at the top
    try { sessionStorage.setItem('billkhata_filters', JSON.stringify(next)); } catch { /* ignore */ }
  };
  // "/" from elsewhere lands here with ?search.
  useEffect(() => {
    if (window.location.hash.includes('?search')) searchRef.current?.focus();
  }, []);

  const list = filterExpenses(expenses, f);
  // Long histories show a page at a time (80 bills), so the list stays quick to open and scroll.
  const [shown, setShown] = useState(PAGE);
  const page = list.slice(0, shown);
  const t = reportTotals(list);
  const today = todayAD();
  const tBs = todayBS();
  const monthName = tBs ? BS_MONTHS[parseYmd(tBs).m - 1] : 'Month';
  const ranges = [['today', 'Today'], ['week', 'Week'], ['bsmonth', monthName], ['all', 'All'], ['custom', 'Custom']];
  const extra = [f.category, f.payment, f.status].filter(Boolean).length;
  const groups = groupByDay(page);

  if (!expenses.length) {
    return (
      <div>
        <h1 className="t-h-l mb-5 text-ink">Ledger</h1>
        <Card><NoBillsYet /></Card>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="t-h-l text-ink">Ledger</h1>
        <div className="flex items-center gap-2">
          <Button variant="tonal" icon={Zap} onClick={() => openSheet('quickOut')} aria-label="Quick expense"><span className="sm:hidden">Expense</span><span className="hidden sm:inline">Quick expense</span></Button>
          <a href="#/reports" className={iconBtn} aria-label="Export: CSV and PDF reports" title="Export"><Download className="size-5" /></a>
          <button type="button" className={iconBtn} onClick={() => setFiltering(true)} aria-label={`Filters${extra ? ` (${extra} on)` : ''}`} title="Filters">
            <SlidersHorizontal className="size-5" />
            {extra > 0 && <span className="absolute -right-0.5 -top-0.5 flex size-[18px] items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-on-brand">{extra}</span>}
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-ink-3" />
        <input ref={searchRef} data-search type="search" className="input h-12 pl-11" placeholder="Shop, PAN, bill no., code or coupon" value={f.search} onChange={(e) => update({ search: e.target.value })} aria-label="Search bills" />
      </div>
      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {ranges.map(([value, label]) => (
          <Chip key={value} selected={f.range === value} onClick={() => (value === 'custom' ? setFiltering(true) : update({ range: value }))}>{label}</Chip>
        ))}
      </div>

      <Card className="mt-3 grid grid-cols-3 divide-x divide-line rounded-2xl py-3 text-center">
        <div><p className="t-caption text-ink-3">{list.length} bill{list.length === 1 ? '' : 's'}</p><p className="num font-nepali text-[16px] font-semibold text-ink">{money(t.total)}</p></div>
        <div><p className="t-caption text-ink-3">VAT</p><p className="num font-nepali text-[16px] font-semibold text-ink">{money(t.vat)}</p></div>
        <div><p className="t-caption text-ink-3">Coupons</p><p className="text-[16px] font-semibold text-ink">{t.coupons} saved</p></div>
      </Card>

      {list.length ? (
        <>
          <div className="mt-5 md:hidden">
            {groups.map((g) => (
              <section key={g.day || 'none'} className="mb-5">
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <h2 className="t-overline text-ink-3">{dayHeading(g.day, today)}</h2>
                  <span className="num font-nepali text-[14px] text-ink-2">{money(g.bills.reduce((s, e) => s + (Number(e.split ? e.split.myShare : e.totalAmount) || 0), 0))}</span>
                </div>
                <BillCards list={g.bills} pan />
              </section>
            ))}
          </div>
          <Card className="mt-4 hidden overflow-hidden rounded-[20px] md:block">
            <BillTable list={page} pan />
          </Card>
          {list.length > shown && (
            <Button className="mt-3 w-full" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more <span className="font-normal text-ink-3">· {list.length - shown} left</span></Button>
          )}
        </>
      ) : (
        <Card className="mt-4">
          <EmptyState icon={Search} title="No bills match" action={<Button onClick={() => update(EMPTY)} icon={RotateCcw}>Clear filters</Button>}>
            Try a wider date range or fewer filters.
          </EmptyState>
        </Card>
      )}

      {expenses.length < 3 && (
        <a href="#/scan" className="mt-4 flex items-center justify-center gap-2 text-[14px] font-medium text-brand hover:underline"><ScanLine className="size-4" />Scan another bill</a>
      )}
      {filtering && <FilterSheet f={f} update={update} onClose={() => setFiltering(false)} />}
    </div>
  );
}
