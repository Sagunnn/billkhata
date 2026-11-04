// Home (Figma: Phone 01 · Home, Desktop 1 · Home): what you have now, the lucky draw when it's
// relevant, this month at a glance, where it went, and the latest bills.
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CalendarDays, ChevronRight, History, Luggage, PencilLine, Plus, ScanLine, Search,
  SlidersHorizontal, Ticket, Trash, TriangleAlert, Trophy, UserRound, Users, Zap,
} from 'lucide-react';
import { IRD_STATUS, PAYMENT, REGIONS } from '../lib/constants.js';
import { blankExpense, byCategory, countsAsSpend, filterExpenses, reportTotals } from '../lib/expense.js';
import { money } from '../lib/format.js';
import { formatCoupon, needsManualEntry } from '../lib/ird.js';
import { moneyNow } from '../lib/money.js';
import { BS_MONTHS, drawWindowFor, formatAD, formatBS, parseYmd, shortBS, todayAD, todayBS } from '../lib/nepaliDate.js';
import { CATEGORY_ICONS, CATEGORY_SHORT } from '../lib/categoryIcons.js';
import { isDemoProfile, useStore } from '../store.jsx';
import { NoBillsYet } from '../components/ExpenseList.jsx';
import { BillCards, BillTable } from '../components/BillCard.jsx';
import { StorageIndicator } from '../components/LocalFirst.jsx';
import { Wordmark } from '../components/Brand.jsx';
import { ACCOUNT_ICON } from '../components/MoneySheets.jsx';
import { ActionChip, Button, Card, Kbd, Notice } from '../components/ui.jsx';
import { useToast } from '../components/Toast.jsx';
import { InstallCard } from '../components/InstallGuide.jsx';
import { openWins, WinnerCheckModal } from '../components/Winners.jsx';
import { moneyLookCount } from './Money.jsx';
import { calculateTripSettlement, ongoingTrips, tripDay } from '../lib/trips.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HERO_BG = { backgroundImage: 'linear-gradient(180deg, rgba(245,189,82,0.13) 0%, rgba(245,189,82,0) 50%)' };

/** Opens the ledger with a filter (or a search) already set. */
function openLedger(patch) {
  try { sessionStorage.setItem('billkhata_filters', JSON.stringify({ range: 'all', ...patch })); } catch { /* ignore */ }
  window.location.hash = '#/ledger';
}

/* ---------- what you have now ---------- */

function HeroAction({ icon: Icon, label, onClick }) {
  return (
    <button type="button" onClick={onClick} className="tap flex min-w-[64px] flex-col items-center gap-1.5 py-1">
      <span className="flex size-11 items-center justify-center rounded-full bg-[rgba(255,255,255,0.1)] text-hero-ink"><Icon className="size-5" /></span>
      <span className="whitespace-nowrap text-[13px] font-medium leading-4 text-hero-ink">{label}</span>
    </button>
  );
}

function HeroPill({ icon: Icon, label, onClick, shortcut }) {
  return (
    <button type="button" onClick={onClick} className="tap inline-flex h-9 items-center gap-2 rounded-lg bg-[rgba(255,255,255,0.1)] px-3.5 text-[14px] font-medium text-hero-ink hover:bg-[rgba(255,255,255,0.16)]">
      <Icon className="size-4" />{label}{shortcut && <Kbd tone="hero">{shortcut}</Kbd>}
    </button>
  );
}

function Tile({ icon: Icon, label, value, sub }) {
  return (
    <div className="min-w-0 flex-1 rounded-[14px] bg-hero-soft p-3">
      <p className="flex items-center gap-1.5 text-[13px] leading-4 text-hero-muted"><Icon className="size-3.5 shrink-0" /><span className="truncate">{label}</span></p>
      <p className="num mt-1 truncate font-nepali text-[18px] font-semibold leading-6 text-hero-ink">{value}</p>
      {sub && <p className="mt-0.5 truncate text-[12px] leading-4 text-hero-muted">{sub}</p>}
    </div>
  );
}

function WalletHero() {
  const { money: m, expenses, openSheet } = useStore();
  const now = useMemo(() => moneyNow(m, expenses), [m, expenses]);
  const go = (type) => openSheet(now.ready ? type : 'accounts');
  const more = () => { window.location.hash = '#/money'; };
  const head = (
    <div className="flex items-center justify-between">
      <p className="t-overline text-hero-muted">What you have now</p>
      {now.ready && <button type="button" onClick={() => openSheet('moneyHistory')} className="flex items-center gap-0.5 text-[13px] font-medium text-hero-muted hover:text-hero-ink md:hidden">History<ChevronRight className="size-4" /></button>}
    </div>
  );
  if (!now.ready) {
    return (
      <section className="rounded-2xl bg-hero p-5 text-hero-ink shadow-lg" style={HERO_BG}>
        {head}
        <p className="mt-2 text-[22px] font-semibold leading-7">Set your cash, bank and wallets once</p>
        <p className="mt-1 text-[14px] leading-5 text-hero-muted">Every bill you save then comes off the account it was paid from, so this stays right.</p>
        <button type="button" onClick={() => openSheet('accounts')} className="tap mt-4 inline-flex h-11 items-center gap-2 rounded-[12px] bg-hero-ink px-4 text-[15px] font-semibold text-hero"><Plus className="size-5" />Set your accounts</button>
      </section>
    );
  }
  const today = todayAD();
  const cash = now.accounts.filter((a) => a.kind === 'cash');
  const banks = now.accounts.filter((a) => a.kind !== 'cash');
  const cashToday = expenses.filter((e) => !e.isSample && countsAsSpend(e) && e.billDateAD === today && e.paymentMethod !== PAYMENT.DIGITAL).length;
  const spent = now.accounts.reduce((t, a) => t + a.spent, 0);
  const desk = now.accounts.length > 4 ? [...now.accounts.slice(0, 3), { id: '_more', name: `${now.accounts.length - 3} more`, kind: 'bank', balance: now.accounts.slice(3).reduce((t, a) => t + a.balance, 0) }] : now.accounts;
  return (
    <section className="rounded-2xl bg-hero p-5 text-hero-ink shadow-lg md:p-6" style={HERO_BG}>
      <div className="md:flex md:items-start md:justify-between">
        <div>
          {head}
          <p className="t-money-xl num mt-1 font-nepali">{money(now.total)}</p>
        </div>
        <div className="hidden text-right md:block">
          <p className="text-[13px] text-hero-muted">Spent since {shortBS(m.since)}</p>
          <p className="num font-nepali text-[18px] font-semibold">{money(spent)}</p>
        </div>
      </div>
      {/* Phone: cash and banks together; desktop: each account. */}
      <div className="mt-4 flex gap-2.5 md:hidden">
        {cash.length > 0 && <Tile icon={ACCOUNT_ICON.cash} label={cash.length > 1 ? 'Cash' : cash[0].name} value={money(now.cash)} sub={cashToday ? `After ${cashToday} bill${cashToday === 1 ? '' : 's'} today` : 'Counted by you'} />}
        {banks.length > 0 && <Tile icon={ACCOUNT_ICON.bank} label={banks.length > 1 ? 'Bank & wallets' : banks[0].name} value={money(now.bank)} sub={banks.length > 1 ? banks.map((a) => a.name.split(' ')[0]).join(' · ') : ''} />}
      </div>
      <div className="mt-5 hidden gap-2.5 md:flex">
        {desk.map((a) => <Tile key={a.id} icon={ACCOUNT_ICON[a.kind]} label={a.name} value={money(a.balance)} />)}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-hero-line pt-3 md:hidden">
        <span className="text-[14px] text-hero-muted">Spent since {shortBS(m.since)}</span>
        <span className="num font-nepali text-[15px] font-semibold">{money(spent)}</span>
      </div>
      <div className="mt-3 flex justify-between md:hidden">
        <HeroAction icon={ArrowDownLeft} label="Money in" onClick={() => go('moneyIn')} />
        <HeroAction icon={ArrowLeftRight} label="ATM / Move" onClick={() => go('move')} />
        <HeroAction icon={ArrowUpRight} label="Quick expense" onClick={() => openSheet('quickOut')} />
        <HeroAction icon={Plus} label="More" onClick={more} />
      </div>
      <div className="mt-5 hidden flex-wrap gap-2 md:flex">
        <HeroPill icon={ArrowDownLeft} label="Money in" onClick={() => go('moneyIn')} />
        <HeroPill icon={ArrowLeftRight} label="ATM / Move" onClick={() => go('move')} />
        <HeroPill icon={ArrowUpRight} label="Quick expense" shortcut="Q" onClick={() => openSheet('quickOut')} />
        <HeroPill icon={History} label="History" onClick={() => openSheet('moneyHistory')} />
      </div>
    </section>
  );
}

/* ---------- a trip that's on ---------- */

/** While a trip is on: what it's at, and Scan a bill / Quick expense straight into it. */
function TripNow({ trip }) {
  const { openSheet, profile } = useStore();
  const s = useMemo(() => calculateTripSettlement(trip), [trip]);
  const mine = s.members.find((m) => m.isMe);
  const href = `#/trip/${encodeURIComponent(trip.id)}`;
  return (
    <section className="rounded-2xl border border-marigold/40 bg-marigold-soft p-4">
      <a href={href} className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-marigold text-[#2b1a00]"><Luggage className="size-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-ink">On a trip · {trip.name}</span>
          <span className="t-caption num block truncate text-ink-2">
            Day {tripDay(trip)} · {trip.members.length} {trip.members.length === 1 ? 'person' : 'people'} · {money(s.total, profile.region)} so far{mine && mine.totalConsumed ? ` · your part ${money(mine.totalConsumed, profile.region)}` : ''}
          </span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-ink-2" />
      </a>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a href={`#/scan?trip=${encodeURIComponent(trip.id)}`} className="tap inline-flex h-11 items-center justify-center gap-2 rounded-[12px] bg-brand text-[14px] font-semibold text-on-brand hover:bg-brand-dark"><ScanLine className="size-[18px]" />Scan a bill</a>
        <button type="button" onClick={() => openSheet('tripQuick', { tripId: trip.id })} className="tap inline-flex h-11 items-center justify-center gap-2 rounded-[12px] border border-line-strong bg-surface text-[14px] font-semibold text-ink hover:bg-sunken"><Zap className="size-[18px]" />Quick expense</button>
      </div>
    </section>
  );
}

/* ---------- lucky draw ---------- */

/** Cash bills in this draw window still to enter, newest first. */
function useLucky() {
  const { expenses, profile, settings } = useStore();
  const tBs = todayBS();
  const win = drawWindowFor(tBs);
  const ready = filterExpenses(expenses.filter((e) => needsManualEntry(e) && (!win || !e.billDateBS || (e.billDateBS >= win.startBS && e.billDateBS <= win.endBS))), { range: 'all' });
  const coupons = expenses.filter((e) => /^\d{12}$/.test(e.irdCoupon || '')).length;
  const show = profile.region === REGIONS.NEPAL && settings.showLuckyDraw !== false && Boolean(win);
  return { win, ready, coupons, show };
}

function LuckyStrip() {
  const { win, ready, show } = useLucky();
  if (!show || !ready.length) return null;
  return (
    <button type="button" onClick={() => openLedger({ status: IRD_STATUS.NOT_APPLIED })} className="tap flex w-full items-center gap-3 rounded-[18px] bg-marigold-soft p-3.5 text-left md:hidden">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-marigold text-[#2b1a00]"><Ticket className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-[22px] text-ink">{ready.length} cash bill{ready.length === 1 ? '' : 's'} ready for the lucky draw</span>
        <span className="block text-[14px] leading-[18px] text-ink-2">{win.label.split(' ')[0]} window {win.daysLeft === 0 ? 'closes today' : `closes in ${win.daysLeft} day${win.daysLeft === 1 ? '' : 's'}`}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-ink-2" />
    </button>
  );
}

function LuckyPanel() {
  const { openIrd, openSheet } = useStore();
  const { win, ready, coupons, show } = useLucky();
  if (!show) return null;
  const month = win.label.split(' ')[0];
  return (
    <section className="rounded-2xl bg-marigold-soft p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-marigold text-[#2b1a00]"><Ticket className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-ink">Lucky draw · {month}</p>
          <p className="t-caption text-ink-2">{coupons} coupon{coupons === 1 ? '' : 's'} saved · {ready.length} ready to apply</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-raised px-2 py-1 text-[12px] font-medium text-marigold-ink"><CalendarDays className="size-3.5" />{win.daysLeft === 0 ? 'Last day' : `${win.daysLeft} days left`}</span>
      </div>
      {ready.length > 0 && (
        <>
          <ul className="mt-3 space-y-2">
            {ready.slice(0, 3).map((e) => (
              <li key={e.id} className="flex items-center gap-3 rounded-[12px] bg-raised px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">{e.merchantName || 'Untitled bill'}</span>
                  <span className="t-caption num block text-ink-3">{money(e.totalAmount)} · cash</span>
                </span>
                <button type="button" onClick={() => openIrd(e)} className="text-[14px] font-medium text-brand hover:underline">Apply</button>
              </li>
            ))}
          </ul>
          {ready.length > 3 && <button type="button" onClick={() => openLedger({ status: IRD_STATUS.NOT_APPLIED })} className="t-caption mt-2 font-medium text-ink-2 hover:underline">and {ready.length - 3} more</button>}
          <Button variant="primary" size="lg" icon={Ticket} className="mt-3 w-full" onClick={() => openSheet('ird', { expense: ready[0], queue: ready.slice(1).map((e) => e.id) })}>
            Apply all ({ready.length})
          </Button>
          <p className="t-caption mt-2 text-ink-2">One at a time, since the IRD site asks for a captcha each time. Close a bill without saving to stop.</p>
        </>
      )}
      <p className="t-caption mt-3 text-ink-2">Fonepay and card bills are entered by your bank. Nothing to do.</p>
    </section>
  );
}

/* ---------- this month ---------- */

function StatTile({ label, value, sub, tone = 'muted' }) {
  return (
    <div className="card flex min-w-0 flex-col gap-1 rounded-2xl p-3.5">
      <p className="t-overline truncate text-ink-3">{label}</p>
      <p className="num truncate font-nepali text-[22px] font-semibold leading-7 tracking-[-0.3px] text-ink">{value}</p>
      <p className={`truncate text-[12px] leading-4 ${tone === 'good' ? 'text-leaf' : tone === 'bad' ? 'text-warn' : 'text-ink-3'}`}>{sub}</p>
    </div>
  );
}

/** Bills in the BS month `ym` ("2083-07"), up to day `upTo` when given. */
const inBsMonth = (expenses, ym, upTo = 32) => expenses.filter((e) => countsAsSpend(e) && (e.billDateBS || '').slice(0, 7) === ym && Number((e.billDateBS || '').slice(8, 10)) <= upTo);

function useMonth() {
  const { expenses, profile } = useStore();
  const isNepal = profile.region === REGIONS.NEPAL;
  const tBs = todayBS();
  const p = tBs && parseYmd(tBs);
  if (isNepal && p) {
    const ym = tBs.slice(0, 7);
    const prev = p.m === 1 ? `${p.y - 1}-12` : `${p.y}-${String(p.m - 1).padStart(2, '0')}`;
    return {
      list: inBsMonth(expenses, ym),
      before: inBsMonth(expenses, prev, p.d),
      name: BS_MONTHS[p.m - 1],
      prevName: BS_MONTHS[(p.m + 10) % 12],
    };
  }
  const now = new Date();
  const prevD = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const pre = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}`;
  return {
    list: filterExpenses(expenses.filter(countsAsSpend), { range: 'month' }),
    before: expenses.filter((e) => countsAsSpend(e) && (e.billDateAD || '').slice(0, 7) === pre && Number(e.billDateAD.slice(8, 10)) <= now.getDate()),
    name: now.toLocaleDateString('en-GB', { month: 'long' }),
    prevName: prevD.toLocaleDateString('en-GB', { month: 'long' }),
  };
}

function Stats({ month }) {
  const { expenses } = useStore();
  const today = todayAD();
  const todays = expenses.filter((e) => countsAsSpend(e) && e.billDateAD === today);
  const t = reportTotals(month.list);
  const before = reportTotals(month.before).total;
  const change = before > 0 ? Math.round(((t.total - before) / before) * 100) : null;
  const taxBills = month.list.filter((e) => Number(e.vatAmount) > 0).length;
  const paid = t.cash + t.digital;
  const qr = paid ? Math.round((t.digital / paid) * 100) : 0;
  const sum = (l) => l.reduce((s, e) => s + (Number(e.totalAmount) || 0), 0);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile label="Today" value={money(sum(todays))} sub={todays.length ? `${todays.length} bill${todays.length === 1 ? '' : 's'} · ${todays.filter((e) => e.paymentMethod !== PAYMENT.DIGITAL).length} cash` : 'No bills yet today'} />
      <StatTile label={`${month.name} so far`} value={money(t.total)}
        sub={change == null ? `${month.list.length} bill${month.list.length === 1 ? '' : 's'}` : `${change <= 0 ? '↓' : '↑'} ${Math.abs(change)}% vs ${month.prevName}`}
        tone={change == null ? 'muted' : change <= 0 ? 'good' : 'bad'} />
      <StatTile label="VAT paid" value={money(t.vat)} sub={`on ${taxBills} tax bill${taxBills === 1 ? '' : 's'}`} />
      <StatTile label="Paid by" value={paid ? `${qr}% QR` : '—'} sub={paid ? `${100 - qr}% cash` : 'No bills this month'} />
    </div>
  );
}

function WhereItWent({ month, icons = true }) {
  const data = byCategory(month.list).slice(0, 5);
  const max = Math.max(...data.map((d) => d.total), 1);
  return (
    <Card className="rounded-[20px] p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[18px] font-semibold leading-6 text-ink">Where it went · {month.name}</h2>
        <a href="#/reports" className="text-[14px] font-medium text-brand hover:underline">Report</a>
      </div>
      {data.length ? (
        <ul className="mt-3.5 space-y-3.5">
          {data.map((d) => {
            const Icon = CATEGORY_ICONS[d.category] || CATEGORY_ICONS.Other;
            return (
              <li key={d.category} className="flex items-center gap-3">
                {icons && <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-sunken text-ink-2"><Icon className="size-[18px]" /></span>}
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2 text-[14px] leading-[18px] text-ink">
                    <span className="truncate font-medium">{icons ? d.category : CATEGORY_SHORT[d.category] || d.category}</span>
                    <span className="num font-nepali font-medium">{money(d.total)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-[3px] bg-sunken">
                    <div className="h-full rounded-[3px] bg-navy" style={{ width: `${Math.max(3, (d.total / max) * 100)}%` }} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="t-body py-4 text-ink-3">No bills in {month.name} yet.</p>}
    </Card>
  );
}

function BankLookCard() {
  const { bankRecon, money: m } = useStore();
  const n = moneyLookCount({ bankRecon, money: m });
  if (!n) return null;
  return (
    <a href="#/money" className="card flex items-center gap-3 rounded-2xl p-4 transition hover:border-line-strong">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-warn-soft text-warn"><TriangleAlert className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-ink">{n} bank row{n === 1 ? '' : 's'} need{n === 1 ? 's' : ''} a look</span>
        <span className="t-caption block text-ink-3">Payments without a bill, or money in not counted yet</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-ink-3" />
    </a>
  );
}

/* ---------- page ---------- */

function DeskSearch() {
  const [q, setQ] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); openLedger({ search: q.trim() }); }} className="relative w-72">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
      <input data-search className="input h-10 py-0 pl-9 pr-10" placeholder="Search bills" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search bills" />
      <Kbd className="absolute right-2.5 top-1/2 -translate-y-1/2">/</Kbd>
    </form>
  );
}

export default function Dashboard() {
  const { expenses, profile, openEditor, openSheet, trips, removeSamples } = useStore();
  const toast = useToast();
  const samples = expenses.filter((e) => e.isSample).length;
  const region = profile.region;
  const tBs = todayBS();
  const month = useMonth();
  const recent = filterExpenses(expenses, { range: 'all' }).slice(0, 5);
  const [winnerModal, setWinnerModal] = useState(null); // null | [] (check) | [bill] (claim)
  const wins = openWins(expenses);
  const first = profile.fullName && !isDemoProfile(profile) ? profile.fullName.split(' ')[0] : '';
  // The home-screen shortcut "Quick expense" opens /#/?quick.
  useEffect(() => {
    if (!window.location.hash.includes('?quick')) return;
    window.history.replaceState(null, '', '#/');
    openSheet('quickOut');
  }, [openSheet]);
  const d = new Date();
  const dateLine = [WEEKDAYS[d.getDay()], tBs && formatBS(tBs), formatAD(todayAD())].filter(Boolean).join(' · ');

  return (
    <div>
      {/* Phone header: logo, where your data is, settings. */}
      <div className="-mx-1 mb-5 flex items-center justify-between md:hidden">
        <Wordmark size={36} />
        <div className="flex items-center gap-2">
          <StorageIndicator />
          <a href="#/settings" aria-label="Settings" className="tap flex size-10 items-center justify-center rounded-full border border-line bg-surface text-ink"><SlidersHorizontal className="size-5" /></a>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="t-h-l text-ink">Namaste{first ? `, ${first}` : ''}</h1>
          <p className="mt-0.5 text-[14px] font-medium leading-[18px] text-ink-2">{dateLine}</p>
        </div>
        <div className="hidden items-center gap-2 md:flex">
          <DeskSearch />
          <Button icon={Trophy} onClick={() => setWinnerModal([])}>Check IRD winners</Button>
        </div>
      </div>

      {/* Phone quick actions, scrolling sideways. */}
      <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 md:hidden">
        <button type="button" className="chip tap" onClick={() => openSheet('quickOut')}><Zap className="size-4" />Quick expense</button>
        <button type="button" className="chip tap" onClick={() => openEditor(blankExpense(region))}><PencilLine className="size-4" />Add by hand</button>
        <a href="#/split" className="chip tap"><Users className="size-4" />Split a bill</a>
        <button type="button" className="chip tap" onClick={() => setWinnerModal([])}><Trophy className="size-4" />Check IRD winners</button>
      </div>

      <div className="mt-4 space-y-3">
        {samples > 0 ? (
          <Notice tone="warning" title={`You’re looking at ${samples} sample bills`}
            action={(
              <div className="flex flex-wrap gap-2">
                {isDemoProfile(profile) && <ActionChip icon={UserRound} onClick={() => openSheet('welcome', { step: 'details' })}>Set up my account</ActionChip>}
                <ActionChip icon={Trash} onClick={async () => { const n = await removeSamples(); toast(n ? 'Sample bills removed: your ledger starts empty.' : 'No sample bills left.'); }}>Remove samples</ActionChip>
              </div>
            )}>
            They show how everything works. Try a scan, a split or the lucky draw with them, then start fresh.
          </Notice>
        ) : isDemoProfile(profile) && (
          <Notice tone="info" icon={UserRound} title="Add your details"
            action={<ActionChip onClick={() => openSheet('welcome', { step: 'details' })}>Add my details</ActionChip>}>
            Your name, mobile and address fill the IRD lucky draw form for you.
          </Notice>
        )}
        {wins.map((b) => (
          <Notice key={b.id} tone="prize" icon={Trophy} title={`Coupon ${formatCoupon(b.irdCoupon)} won!`}
            action={<button type="button" onClick={() => setWinnerModal([b])} className="text-[14px] font-medium text-marigold-ink underline">Claim checklist</button>}>
            {b.merchantName} · claim by {formatAD(b.irdWin.claimByAD)} with the original paper bill.
          </Notice>
        ))}
      </div>

      {!isDemoProfile(profile) && <div className="mt-3"><InstallCard /></div>}

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0 space-y-4">
          {ongoingTrips(trips).slice(0, 2).map((t) => <TripNow key={t.id} trip={t} />)}
          <WalletHero />
          <LuckyStrip />
          <Stats month={month} />
          <div className="lg:hidden"><WhereItWent month={month} /></div>
          <div className="lg:hidden"><BankLookCard /></div>

          <section>
            <div className="flex items-center justify-between px-1 pt-2 md:hidden">
              <h2 className="text-[18px] font-semibold leading-6 text-ink">Recent bills</h2>
              <a href="#/ledger" className="text-[14px] font-medium text-brand hover:underline">Open ledger</a>
            </div>
            <div className="mt-3 md:hidden">{recent.length ? <BillCards list={recent} /> : <Card><NoBillsYet /></Card>}</div>
            <Card className="hidden overflow-hidden rounded-[20px] md:block">
              <div className="flex items-center justify-between gap-3 px-5 py-4">
                <h2 className="text-[18px] font-semibold text-ink">Recent bills</h2>
                <div className="flex items-center gap-3">
                  <span className="kbd hidden items-center gap-1 text-[12px] text-ink-3 lg:flex"><Kbd>J</Kbd><Kbd>K</Kbd> move <Kbd className="ml-2">↵</Kbd> open</span>
                  <a href="#/ledger" className="text-[14px] font-medium text-brand hover:underline">Open ledger</a>
                </div>
              </div>
              {recent.length ? <BillTable list={recent} /> : <NoBillsYet />}
            </Card>
          </section>
        </div>

        <aside className="hidden space-y-4 lg:block">
          <LuckyPanel />
          <WhereItWent month={month} icons={false} />
          <BankLookCard />
        </aside>
      </div>
      {winnerModal && <WinnerCheckModal initial={winnerModal} onClose={() => setWinnerModal(null)} />}
    </div>
  );
}
