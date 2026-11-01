import { useEffect, useState } from 'react';
import { FileText, Landmark, LayoutDashboard, List, Luggage, PencilLine, ScanLine, Settings as SettingsIcon, Split as SplitIcon } from 'lucide-react';
import { useStore } from './store.jsx';
import { ModalHost } from './components/Modals.jsx';
import { StorageIndicator, StorageNote } from './components/LocalFirst.jsx';
import { Skeleton } from './components/ui.jsx';
import { blankExpense } from './lib/expense.js';
import Dashboard from './views/Dashboard.jsx';
import Ledger from './views/Ledger.jsx';
import Scan from './views/Scan.jsx';
import Reports from './views/Reports.jsx';
import Bank from './views/Bank.jsx';
import Settings from './views/Settings.jsx';
import CouponImport from './views/CouponImport.jsx';
import { SplitEditor, SplitHub, SplitShare } from './views/Split.jsx';
import { TripsHub, TripView } from './views/Trips.jsx';

const ROUTES = [
  { path: '', label: 'Dashboard', icon: LayoutDashboard, view: Dashboard },
  { path: 'ledger', label: 'Ledger', icon: List, view: Ledger },
  { path: 'scan', label: 'Scan', icon: ScanLine, view: Scan },
  { path: 'split', label: 'Split', icon: SplitIcon, view: SplitHub },
  { path: 'trips', label: 'Trips', icon: Luggage, view: TripsHub, desktopOnly: true },
  { path: 'bank', label: 'Bank', icon: Landmark, view: Bank, desktopOnly: true },
  { path: 'reports', label: 'Reports', icon: FileText, view: Reports, desktopOnly: true },
  { path: 'settings', label: 'Settings', icon: SettingsIcon, view: Settings },
];

function useHashRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('?')[0];
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

function Logo() {
  return (
    <a href="#/" className="tap flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="size-8" />
      <span className="text-lg font-extrabold tracking-tight">Bill<span className="text-brand">Khata</span></span>
    </a>
  );
}

/** Scan and Add by hand, one per line, full width. */
function AddButtons({ className = '' }) {
  const { openEditor, profile } = useStore();
  return (
    <div className={`grid gap-2 ${className}`}>
      <a href="#/scan" className="tap flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-brand px-3 font-semibold text-white shadow-sm hover:bg-brand-dark">
        <ScanLine className="size-5" />Scan a bill
      </a>
      <button type="button" onClick={() => openEditor(blankExpense(profile.region))} className="tap flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 font-semibold text-slate-800 hover:bg-slate-50">
        <PencilLine className="size-[18px]" />Add by hand
      </button>
    </div>
  );
}

function Sidebar({ route }) {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-slate-200 bg-white px-4 py-5 md:flex">
      <Logo />
      <AddButtons className="mt-6" />
      <nav className="mt-5 space-y-1">
        {ROUTES.filter((r) => r.path !== 'scan').map(({ path, label, icon: Icon }) => (
          <a
            key={path}
            href={`#/${path}`}
            aria-current={route === path ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${route === path ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
          >
            <Icon className="size-[18px]" />{label}
          </a>
        ))}
      </nav>
      <div className="mt-auto"><StorageNote /></div>
    </aside>
  );
}

function BottomNav({ route }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur pb-safe md:hidden">
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {ROUTES.filter((r) => !r.desktopOnly).map(({ path, label, icon: Icon }) => {
          const active = route === path;
          if (path === 'scan') {
            return (
              <a key={path} href="#/scan" className="flex flex-col items-center" aria-current={active ? 'page' : undefined} aria-label="Scan a bill">
                <span className="-mt-5 flex size-14 items-center justify-center rounded-full bg-brand text-white shadow-lg ring-4 ring-white">
                  <ScanLine className="size-6" />
                </span>
                <span className="mt-0.5 text-[11px] font-bold text-brand">Scan</span>
              </a>
            );
          }
          return (
            <a key={path} href={`#/${path}`} aria-current={active ? 'page' : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-semibold ${active ? 'text-slate-900' : 'text-slate-500'}`}>
              <Icon className="size-5" strokeWidth={active ? 2.5 : 2} />{label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}

/** Placeholder shapes while the bills load from IndexedDB, so the page doesn't jump. */
function LoadingView() {
  return (
    <div aria-busy="true" aria-label="Loading your bills">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-7 w-56" />
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="card p-4"><Skeleton className="h-3 w-20" /><Skeleton className="mt-3 h-7 w-28" /></div>)}
      </div>
      <div className="card mt-5 divide-y divide-slate-100">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-11" />
            <div className="flex-1"><Skeleton className="h-4 w-1/2" /><Skeleton className="mt-2 h-3 w-3/4" /></div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
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

export default function App() {
  const route = useHashRoute();
  useDropGuard();
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

  useEffect(() => {
    document.title = `${current.label} · BillKhata`;
  }, [current.label]);

  return (
    <div className="min-h-dvh">
      <Sidebar route={current.path} />
      <header className="pt-safe gutter sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur md:hidden">
        <div className="flex h-14 items-center justify-between gap-3">
          <Logo />
          <StorageIndicator />
        </div>
      </header>
      <main className="gutter main-pad pt-5 md:ml-60 md:pt-8">
        <div className="mx-auto max-w-6xl">
          {loadError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              Could not open local storage: {loadError} Bills will not be saved in this window.
            </div>
          )}
          {ready ? <View key={route} {...viewProps} /> : <LoadingView />}
        </div>
      </main>
      <BottomNav route={current.path} />
      <ModalHost />
    </div>
  );
}
