import { CalendarDays, ChevronRight, Hourglass, ScanLine, Ticket, UserRound, Wallet } from 'lucide-react';
import { REGIONS } from '../lib/constants.js';
import { byCategory, filterExpenses, summarize } from '../lib/expense.js';
import { money } from '../lib/format.js';
import { needsManualEntry } from '../lib/ird.js';
import { BS_MONTHS, drawWindowFor, formatAD, formatBS, parseYmd, todayAD, todayBS } from '../lib/nepaliDate.js';
import { isDemoProfile, useStore } from '../store.jsx';
import { ExpenseList } from '../components/ExpenseList.jsx';
import { IrdAction } from '../components/Ird.jsx';
import { Card, EmptyState } from '../components/ui.jsx';

function Kpi({ label, value, sub, icon: Icon, tone = 'slate', href }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    brand: 'bg-red-50 text-brand',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
  };
  const Tag = href ? 'a' : 'div';
  return (
    <Tag href={href} className={`card flex flex-col p-4 ${href ? 'transition hover:border-slate-300 hover:shadow' : ''}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
        <span className={`rounded-lg p-1.5 ${tones[tone]}`}><Icon className="size-4" /></span>
      </div>
      <div className="num mt-2 text-2xl font-extrabold tracking-tight text-slate-900 md:text-[28px]">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </Tag>
  );
}

function CategoryBars({ data, region }) {
  const max = Math.max(...data.map((d) => d.total), 1);
  const total = data.reduce((s, d) => s + d.total, 0);
  return (
    <ul className="space-y-3">
      {data.map((d) => (
        <li key={d.category} title={`${d.category}: ${money(d.total, region)} (${Math.round((d.total / total) * 100)}%)`}>
          <div className="mb-1 flex justify-between gap-2 text-sm">
            <span className="font-medium text-slate-800">{d.category}</span>
            <span className="num font-semibold text-slate-900">{money(d.total, region)}</span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-navy" style={{ width: `${Math.max(2, (d.total / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Dashboard() {
  const { expenses, profile } = useStore();
  const region = profile.region;
  const isNepal = region === REGIONS.NEPAL;
  const s = summarize(expenses, { region });
  const tBs = todayBS();
  const win = drawWindowFor(tBs);
  const pending = filterExpenses(expenses.filter((e) => needsManualEntry(e)), { range: 'all' });
  // Nepal users count months in BS; everyone else in AD.
  const monthList = isNepal
    ? expenses.filter((e) => tBs && (e.billDateBS || '').slice(0, 7) === tBs.slice(0, 7))
    : filterExpenses(expenses, { range: 'month' });
  const monthLabel = isNepal && tBs ? `${BS_MONTHS[parseYmd(tBs).m - 1]} ${tBs.slice(0, 4)}` : new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const recent = filterExpenses(expenses, { range: 'all' }).slice(0, 6);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{formatAD(todayAD())}{tBs ? ` · ${formatBS(tBs)} BS` : ''}</p>
          <h1 className="text-2xl font-bold tracking-tight">Namaste{profile.fullName && !isDemoProfile(profile) ? `, ${profile.fullName.split(' ')[0]}` : ''}</h1>
        </div>
        <a href="#/scan" className="hidden h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark md:inline-flex">
          <ScanLine className="size-[18px]" />Scan a bill
        </a>
      </div>

      {isDemoProfile(profile) && (
        <a href="#/settings" className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 hover:bg-amber-100">
          <UserRound className="size-5 shrink-0" />
          <span className="flex-1">You’re looking at <b>sample bills</b> and a <b>demo profile</b>. Add your own details in Settings before applying to the IRD draw.</span>
          <ChevronRight className="size-4" />
        </a>
      )}

      {isNepal && win && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white">
          <span className="flex items-center gap-2 font-semibold"><CalendarDays className="size-4 text-amber-300" />Current IRD draw window: {win.label}</span>
          <span className="text-slate-300">{formatAD(win.startAD)} – {formatAD(win.endAD)} · {win.daysLeft === 0 ? 'last day today' : `${win.daysLeft} day${win.daysLeft === 1 ? '' : 's'} left`}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Today’s spend" value={money(s.today, region)} icon={Wallet} sub={formatAD(todayAD())} />
        <Kpi label="This month" value={money(s.month, region)} icon={CalendarDays} sub={monthLabel} tone="brand" />
        <Kpi label="Eligible IRD bills" value={s.eligible} icon={Ticket} sub={`${s.applied} with coupon saved`} tone="green" href="#/ledger" />
        <Kpi label="Pending IRD entries" value={s.pending} icon={Hourglass} sub="Cash bills to enter" tone="amber" href="#/ledger" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="font-bold">Needs IRD entry</h2>
            <span className="text-xs font-semibold text-slate-500">{pending.length} bill{pending.length === 1 ? '' : 's'}</span>
          </div>
          {pending.length ? (
            <ul className="divide-y divide-slate-100">
              {pending.slice(0, 5).map((e) => (
                <li key={e.id} className="flex flex-col items-start gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{e.merchantName}</div>
                    <div className="text-xs text-slate-500">{formatBS(e.billDateBS) || formatAD(e.billDateAD)} · Bill {e.invoiceNumber || '—'} · <span className="num">{money(e.totalAmount, region)}</span></div>
                  </div>
                  <IrdAction expense={e} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Ticket} title="All caught up">Eligible cash bills you scan will show up here, ready to enter in the IRD draw.</EmptyState>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-0.5 font-bold">Spend by category</h2>
          <p className="mb-4 text-xs text-slate-500">{monthLabel}</p>
          {monthList.length ? <CategoryBars data={byCategory(monthList)} region={region} /> : <p className="py-6 text-center text-sm text-slate-500">No bills this month yet.</p>}
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-bold">Recent bills</h2>
          <a href="#/ledger" className="flex items-center gap-1 text-sm font-semibold text-navy hover:underline">Open ledger<ChevronRight className="size-4" /></a>
        </div>
        {recent.length ? <ExpenseList list={recent} /> : (
          <EmptyState icon={ScanLine} title="No bills yet" action={<a href="#/scan" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white">Scan your first bill</a>}>
            Snap a photo of a bill and BillKhata will read it for you.
          </EmptyState>
        )}
      </Card>
    </div>
  );
}
