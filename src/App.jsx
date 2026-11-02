import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen, ChartColumn, House, Map, PencilLine, ScanLine, SlidersHorizontal, Users, Wallet,
} from 'lucide-react';
import { useStore } from './store.jsx';
import { ModalHost } from './components/Modals.jsx';
import { StorageNote } from './components/LocalFirst.jsx';
import { Wordmark } from './components/Brand.jsx';
import { Kbd, Skeleton } from './components/ui.jsx';
import { blankExpense } from './lib/expense.js';
import Dashboard from './views/Dashboard.jsx';
import Ledger from './views/Ledger.jsx';
import Scan from './views/Scan.jsx';
import Reports from './views/Reports.jsx';
import Money, { moneyLookCount } from './views/Money.jsx';
import Settings from './views/Settings.jsx';
import CouponImport from './views/CouponImport.jsx';
import { SplitEditor, SplitHub, SplitShare } from './views/Split.jsx';
import { TripsHub, TripView } from './views/Trips.jsx';

// Phone: five tabs, Scan raised in the middle; Trips live inside Split, Reports inside Ledger,
// Settings in the Home header. Desktop: the same five plus Trips and Reports in the sidebar.
const ROUTES = [
  { path: '', label: 'Home', icon: House, view: Dashboard, tab: true },
  { path: 'ledger', label: 'Ledger', icon: BookOpen, view: Ledger, tab: true },
  { path: 'scan', label: 'Scan', icon: ScanLine, view: Scan, tab: true },
  { path: 'split', label: 'Split', icon: Users, view: SplitHub, tab: true },
  { path: 'trips', label: 'Trips', icon: Map, view: TripsHub },
  { path: 'money', label: 'Money', icon: Wallet, view: Money, tab: true },
  { path: 'reports', label: 'Reports', icon: ChartColumn, view: Reports },
  { path: 'settings', label: 'Settings', icon: SlidersHorizontal, view: Settings },
];
// Old addresses keep working.
const ALIASES = { bank: 'money' };

function useHashRoute() {
  const read = () => {
    const r = window.location.hash.replace(/^#\/?/, '').split('?')[0];
    return ALIASES[r] ?? r;
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/** Counts shown beside sidebar items: bills, open trips, bank rows that need a look. */
function useNavCounts() {
  const { expenses, trips, bankRecon, money } = useStore();
  return useMemo(() => ({
    ledger: expenses.length,
    trips: trips.filter((t) => t.status !== 'settled').length,
    money: moneyLookCount({ bankRecon, money }),
  }), [expenses, trips, bankRecon, money]);
}

function Sidebar({ route }) {
  const { openEditor, profile } = useStore();
  const counts = useNavCounts();
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-[248px] flex-col border-r border-line bg-surface px-4 py-5 md:flex">
      <a href="#/" aria-label="BillKhata home"><Wordmark size={36} /></a>
      <div className="mt-5 grid gap-2">
        <a href="#/scan" className="tap relative flex h-[52px] items-center justify-center gap-2 rounded-[14px] bg-brand text-[15px] font-semibold text-on-brand hover:bg-brand-dark">
          <ScanLine className="size-5" />Scan a bill<Kbd tone="brand" className="absolute right-3">S</Kbd>
        </a>
        <button type="button" onClick={() => openEditor(blankExpense(profile.region))} className="tap relative flex h-10 items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface text-[14px] font-medium text-ink hover:bg-sunken">
          <PencilLine className="size-[18px]" />Add by hand<Kbd className="absolute right-3">N</Kbd>
        </button>
      </div>
      <nav className="mt-5 space-y-0.5" aria-label="Main">
        {ROUTES.filter((r) => r.path !== 'scan').map(({ path, label, icon: Icon }) => {
          const active = route === path;
          const count = counts[path];
          return (
            <a key={path} href={`#/${path}`} aria-current={active ? 'page' : undefined}
              className={`flex h-[42px] items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition ${active ? 'bg-brand-soft text-brand' : 'text-ink hover:bg-sunken'}`}>
              <Icon className="size-5" strokeWidth={active ? 2.25 : 2} />
              <span className="flex-1">{label}</span>
              {count > 0 && <span className="num text-[13px] text-ink-3">{count}</span>}
            </a>
          );
        })}
      </nav>
      <div className="mt-auto space-y-4">
        <p className="kbd flex items-center gap-1.5 px-1 text-[12px] text-ink-3">Press <Kbd>?</Kbd> for keyboard shortcuts</p>
        <StorageNote />
      </div>
    </aside>
  );
}

function BottomNav({ route }) {
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-safe backdrop-blur md:hidden">
      <div className="relative mx-auto grid h-[66px] max-w-lg grid-cols-5 items-center">
        {ROUTES.filter((r) => r.tab).map(({ path, label, icon: Icon }) => {
          const active = route === path;
          if (path === 'scan') {
            return (
              <a key={path} href="#/scan" aria-label="Scan a bill" aria-current={active ? 'page' : undefined} className="flex flex-col items-center gap-1 self-start">
                <span className="-mt-[23px] flex size-16 items-center justify-center rounded-full border-4 border-canvas bg-brand text-on-brand shadow-scan">
                  <ScanLine className="size-7" />
                </span>
                <span className="text-[12px] font-semibold leading-4 text-ink">Scan</span>
              </a>
            );
          }
          return (
            <a key={path} href={`#/${path}`} aria-current={active ? 'page' : undefined} className="flex flex-col items-center gap-1">
              <span className={`flex h-[30px] w-14 items-center justify-center rounded-full ${active ? 'bg-brand-soft text-brand' : 'text-ink-2'}`}>
                <Icon className="size-[22px]" strokeWidth={active ? 2.25 : 2} />
              </span>
              <span className={`text-[12px] leading-4 ${active ? 'font-semibold text-brand' : 'font-medium text-ink-2'}`}>{label}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}

function LoadingView() {
  return (
    <div aria-busy="true" aria-label="Loading your bills">
      <Skeleton className="h-7 w-52" />
      <Skeleton className="mt-2 h-4 w-60" />
      <div className="mt-5 h-64 rounded-2xl bg-hero" />
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="card p-4"><Skeleton className="h-3 w-20" /><Skeleton className="mt-3 h-7 w-28" /></div>)}
      </div>
      <span className="sr-only">Loading your bills…</span>
    </div>
  );
}

/** A file dropped outside a drop zone would make the browser open it and leave the app. */
function useDropGuard() {
  useEffect(() => {
    const stop = (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); };
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => { window.removeEventListener('dragover', stop); window.removeEventListener('drop', stop); };
  }, []);
}

/**
 * Keyboard first on desktop: S scan · N add by hand · Q quick cash out · / search · ? shortcut list.
 * J / K / ↵ move through and open bills (handled by the lists). Off while typing in a field, or with
 * Cmd / Ctrl / Alt held; Esc closes sheets (handled by each sheet).
 */
function useShortcuts() {
  const { openEditor, openSheet, closeModal, profile, modal, money } = useStore();
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
      const k = e.key;
      if (k === '?') {
        e.preventDefault();
        if (modal?.type === 'shortcuts') closeModal(); else openSheet('shortcuts');
        return;
      }
      if (modal) return;
      if (k === 's' || k === 'S') { e.preventDefault(); window.location.hash = '#/scan'; }
      else if (k === 'n' || k === 'N') { e.preventDefault(); openEditor(blankExpense(profile.region)); }
      else if (k === 'q' || k === 'Q') { e.preventDefault(); openSheet(money.since ? 'quickOut' : 'accounts'); }
      else if (k === '/') {
        e.preventDefault();
        const box = document.querySelector('[data-search]');
        if (box) box.focus();
        else window.location.hash = '#/ledger?search';
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openEditor, openSheet, closeModal, profile.region, modal, money.since]);
}

export default function App() {
  const route = useHashRoute();
  useDropGuard();
  useShortcuts();
  const { ready, loadError } = useStore();
  // #/coupon/<billId>/<code> comes back from the portal helper.
  const couponMatch = /^coupon\/([^/]+)\/(\d+)$/.exec(route);
  const shareMatch = /^split\/([A-Za-z0-9_-]+)$/.exec(route);
  const editMatch = /^split-bill\/(.+)$/.exec(route);
  const tripMatch = /^trip\/(.+)$/.exec(route);
  let current;
  let viewProps = {};
  if (couponMatch) {
    current = { path: 'coupon', label: 'Save coupon', view: CouponImport };
    viewProps = { billId: decodeURIComponent(couponMatch[1]), code: couponMatch[2] };
  } else if (shareMatch) {
    current = { path: 'split', label: 'Shared split', view: SplitShare };
    viewProps = { token: shareMatch[1] };
  } else if (tripMatch) {
    current = { path: 'trips', label: 'Trip', view: TripView };
    viewProps = { tripId: decodeURIComponent(tripMatch[1]) };
  } else if (editMatch) {
    current = { path: 'split', label: 'Split bill', view: SplitEditor };
    viewProps = { billId: decodeURIComponent(editMatch[1]) };
  } else {
    current = ROUTES.find((r) => r.path === route) || ROUTES[0];
  }
  const View = current.view;
  // Trips sit under the Split tab on phones.
  const tabRoute = current.path === 'trips' ? 'split' : current.path;

  useEffect(() => {
    document.title = `${current.label} · BillKhata`;
  }, [current.label]);

  return (
    <div className="min-h-dvh">
      <Sidebar route={current.path} />
      {/* Phone screens have no shared header: Home shows the logo and settings, other screens their title. */}
      <main className="pt-safe gutter main-pad md:ml-[248px]" style={{ '--header-h': 'var(--safe-top)' }}>
        <div className="mx-auto max-w-[1032px] pt-4 md:pt-8">
          {loadError && (
            <div className="mb-4 rounded-[14px] bg-danger-soft p-3 text-[14px] text-danger">
              Could not open local storage: {loadError} Bills will not be saved in this window.
            </div>
          )}
          {ready ? <View key={route} {...viewProps} /> : <LoadingView />}
        </div>
      </main>
      <BottomNav route={tabRoute} />
      <ModalHost />
    </div>
  );
}
