import { useState } from 'react';
import { CalendarDays, ChevronRight, Coins, Hourglass, ScanLine, SearchCheck, Ticket, Trophy, UserRound, Wallet } from 'lucide-react';
import { REGIONS } from '../lib/constants.js';
import { byCategory, filterExpenses, reportTotals, summarize } from '../lib/expense.js';
import { money } from '../lib/format.js';
import { CLAIM_DAYS, formatCoupon, needsCouponOnly, needsManualEntry, normalizeCouponCode } from '../lib/ird.js';
import { BS_MONTHS, drawWindowFor, formatAD, formatBS, parseYmd, todayAD, todayBS } from '../lib/nepaliDate.js';
import { isDemoProfile, useStore } from '../store.jsx';
import { ExpenseList } from '../components/ExpenseList.jsx';
import { IrdAction } from '../components/Ird.jsx';
import { Button, Card, EmptyState } from '../components/ui.jsx';
import { openWins, WinnerCheckModal } from '../components/Winners.jsx';

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

// Validated two-colour palette (dataviz check): cash orange, digital blue.
const SPLIT = { cash: '#ea580c', digital: '#2563eb' };

/** Cash (enter by hand) vs digital (auto-entered) spend, plus VAT paid. */
function CashDigitalCard({ list, region, label }) {
  const t = reportTotals(list);
  const vatBills = list.filter((e) => Number(e.vatAmount) > 0).length;
  const total = t.cash + t.digital;
  const parts = [
    { key: 'cash', name: 'Cash', note: 'enter on the IRD portal yourself', value: t.cash },
    { key: 'digital', name: 'Digital QR / Card', note: 'entered automatically', value: t.digital },
  ];
  const pct = (v) => (total ? Math.round((v / total) * 100) : 0);
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-bold">Cash vs digital</h2>
        <span className="text-xs text-slate-500">{label}</span>
      </div>
      {total ? (
        <>
          <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={parts.map((p) => `${p.name} ${pct(p.value)}%`).join(', ')}>
            {parts.filter((p) => p.value > 0).map((p) => (
              <div key={p.key} title={`${p.name}: ${money(p.value, region)} (${pct(p.value)}%)`} style={{ width: `${(p.value / total) * 100}%`, background: SPLIT[p.key] }} className="h-full first:rounded-l-full last:rounded-r-full" />
            ))}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            {parts.map((p) => (
              <div key={p.key}>
                <dt className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><span className="size-2.5 rounded-sm" style={{ background: SPLIT[p.key] }} />{p.name} · {pct(p.value)}%</dt>
                <dd className="num text-lg font-extrabold text-slate-900">{money(p.value, region)}</dd>
                <dd className="text-xs text-slate-500">{p.note}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : <p className="py-3 text-sm text-slate-500">No bills this month yet.</p>}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-sm">
        <span className="flex items-center gap-1.5 text-slate-600"><Coins className="size-4" />VAT paid</span>
        <span><b className="num text-slate-900">{money(t.vat, region)}</b> <span className="text-xs text-slate-500">on {vatBills} bill{vatBills === 1 ? '' : 's'} with VAT recorded</span></span>
      </div>
    </Card>
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
  // Fonepay / QR bills are already entered; they only need their coupon number saved.
  const couponOnly = filterExpenses(expenses.filter((e) => needsCouponOnly(e)), { range: 'all' });
  const actions = [...pending, ...couponOnly];
  // Nepal users count months in BS; everyone else in AD.
  const monthList = isNepal
    ? expenses.filter((e) => tBs && (e.billDateBS || '').slice(0, 7) === tBs.slice(0, 7))
    : filterExpenses(expenses, { range: 'month' });
  const monthLabel = isNepal && tBs ? `${BS_MONTHS[parseYmd(tBs).m - 1]} ${tBs.slice(0, 4)}` : new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const recent = filterExpenses(expenses, { range: 'all' }).slice(0, 6);
  const [winnerModal, setWinnerModal] = useState(null); // null | [] (check) | [bill] (claim)
  const wins = openWins(expenses);
  const couponCount = expenses.filter((e) => normalizeCouponCode(e.irdCoupon)).length;

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

      {wins.map((b) => (
        <button key={b.id} type="button" onClick={() => setWinnerModal([b])} className="flex w-full items-center gap-3 rounded-xl bg-emerald-600 px-4 py-3 text-left text-sm text-white shadow hover:bg-emerald-700">
          <Trophy className="size-6 shrink-0" />
          <span className="flex-1">
            <b>Coupon {formatCoupon(b.irdCoupon)} won!</b> {b.merchantName} · claim by {formatAD(b.irdWin.claimByAD)} with the original paper bill.
          </span>
          <span className="font-semibold underline">Claim checklist</span>
        </button>
      ))}

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
            <h2 className="font-bold">Needs IRD action</h2>
            <span className="text-xs font-semibold text-slate-500">{pending.length} to enroll · {couponOnly.length} coupon{couponOnly.length === 1 ? '' : 's'} to save</span>
          </div>
          {actions.length ? (
            <ul className="divide-y divide-slate-100">
              {actions.slice(0, 6).map((e) => (
                <li key={e.id} className="flex flex-col items-start gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{e.merchantName}</div>
                    <div className="text-xs text-slate-500">{formatBS(e.billDateBS) || formatAD(e.billDateAD)} · Bill {e.invoiceNumber || '—'} · <span className="num">{money(e.totalAmount, region)}</span></div>
                  </div>
                  <IrdAction expense={e} compact={needsCouponOnly(e)} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Ticket} title="All caught up">Eligible cash bills to enter, and Fonepay/QR bills whose coupon isn’t saved yet, show up here.</EmptyState>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-0.5 font-bold">Spend by category</h2>
          <p className="mb-4 text-xs text-slate-500">{monthLabel}</p>
          {monthList.length ? <CategoryBars data={byCategory(monthList)} region={region} /> : <p className="py-6 text-center text-sm text-slate-500">No bills this month yet.</p>}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <CashDigitalCard list={monthList} region={region} label={monthLabel} />
        <Card className="flex flex-col p-4">
          <h2 className="mb-1 flex items-center gap-2 font-bold"><Trophy className="size-4 text-amber-600" />Winning coupons</h2>
          <p className="text-sm text-slate-600">
            IRD draws winners on the 1st and 16th of each Nepali month. Paste the winners list from prize.ird.gov.np (विजेता सूची) to check your {couponCount} saved coupon{couponCount === 1 ? '' : 's'}.
            Winners have {CLAIM_DAYS} days to claim with the original paper bill.
          </p>
          <div className="mt-auto pt-3">
            <Button variant="dark" icon={SearchCheck} onClick={() => setWinnerModal([])}>Check winning coupons</Button>
          </div>
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
      {winnerModal && <WinnerCheckModal initial={winnerModal} onClose={() => setWinnerModal(null)} />}
    </div>
  );
}
