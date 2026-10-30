import { useState } from 'react';
import { Funnel, Plus, RotateCcw, Search } from 'lucide-react';
import { CATEGORIES, IRD_STATUSES, PAYMENT_METHODS } from '../lib/constants.js';
import { blankExpense, filterExpenses, rangeFor, reportTotals } from '../lib/expense.js';
import { money } from '../lib/format.js';
import { formatAD } from '../lib/nepaliDate.js';
import { useStore } from '../store.jsx';
import { ExpenseList } from '../components/ExpenseList.jsx';
import { Button, Card, EmptyState, PageHeader, Segmented } from '../components/ui.jsx';

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' },
];
const EMPTY = { range: 'all', from: '', to: '', category: '', payment: '', status: '', search: '' };

function readFilters() {
  try {
    return { ...EMPTY, ...JSON.parse(sessionStorage.getItem('billkhata_filters') || '{}') };
  } catch {
    return EMPTY;
  }
}

export default function Ledger() {
  const { expenses, profile, openEditor } = useStore();
  const [f, setF] = useState(readFilters);
  const [showFilters, setShowFilters] = useState(false);
  const update = (patch) => {
    const next = { ...f, ...patch };
    setF(next);
    try { sessionStorage.setItem('billkhata_filters', JSON.stringify(next)); } catch { /* ignore */ }
  };
  const list = filterExpenses(expenses, f);
  const t = reportTotals(list);
  const r = rangeFor(f.range, f);
  const active = [f.category, f.payment, f.status, f.search].filter(Boolean).length + (f.range !== 'all' ? 1 : 0);

  return (
    <div>
      <PageHeader
        title="Ledger"
        subtitle={`${list.length} of ${expenses.length} bills`}
        actions={<><a href="#/reports" className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 md:hidden">PDF report</a><Button variant="dark" icon={Plus} onClick={() => openEditor(blankExpense(profile.region))}>Add manually</Button></>}
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={f.range} onChange={(range) => update({ range })} options={RANGES} className="overflow-x-auto" />
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input className="input py-2 pl-9" placeholder="Search shop, invoice, PAN, coupon" value={f.search} onChange={(e) => update({ search: e.target.value })} aria-label="Search bills" />
          </div>
          <Button size="md" icon={Funnel} onClick={() => setShowFilters((v) => !v)} className="md:hidden">Filters</Button>
          {active > 0 && <Button size="md" variant="ghost" icon={RotateCcw} onClick={() => update(EMPTY)}>Reset</Button>}
        </div>
        <div className={`${showFilters ? 'grid' : 'hidden'} mt-3 grid-cols-1 gap-2 sm:grid-cols-3 md:grid`}>
          <select className="input py-2" value={f.category} onChange={(e) => update({ category: e.target.value })} aria-label="Category">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className="input py-2" value={f.payment} onChange={(e) => update({ payment: e.target.value })} aria-label="Payment method">
            <option value="">All payment methods</option>
            {PAYMENT_METHODS.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className="input py-2" value={f.status} onChange={(e) => update({ status: e.target.value })} aria-label="IRD draw status">
            <option value="">Any IRD draw status</option>
            {IRD_STATUSES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        {f.range === 'custom' && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <input type="date" className="input w-auto py-2" value={f.from} onChange={(e) => update({ from: e.target.value })} aria-label="From date" />
            <span className="text-slate-500">to</span>
            <input type="date" className="input w-auto py-2" value={f.to} onChange={(e) => update({ to: e.target.value })} aria-label="To date" />
          </div>
        )}
      </Card>

      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 px-1 text-sm text-slate-600">
        <span>{r.from || r.to ? `${formatAD(r.from) || '…'} – ${formatAD(r.to) || '…'}` : 'All dates'}</span>
        <span>Total <b className="num text-slate-900">{money(t.total, profile.region)}</b></span>
        <span>VAT <b className="num text-slate-900">{money(t.vat, profile.region)}</b></span>
        <span>Coupons <b className="text-slate-900">{t.coupons}</b></span>
      </div>

      <Card className="overflow-hidden">
        {list.length ? <ExpenseList list={list} /> : (
          <EmptyState icon={Search} title="No bills match" action={active ? <Button onClick={() => update(EMPTY)} icon={RotateCcw}>Clear filters</Button> : null}>
            Try a wider date range or fewer filters.
          </EmptyState>
        )}
      </Card>
    </div>
  );
}
