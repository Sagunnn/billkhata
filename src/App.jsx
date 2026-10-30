import { useEffect, useState } from 'react';
import { FileText, LayoutDashboard, List, ScanLine, Settings as SettingsIcon, ShieldCheck, Split as SplitIcon } from 'lucide-react';
import { useStore } from './store.jsx';
import { ModalHost } from './components/Modals.jsx';
import Dashboard from './views/Dashboard.jsx';
import Ledger from './views/Ledger.jsx';
import Scan from './views/Scan.jsx';
import Reports from './views/Reports.jsx';
import Settings from './views/Settings.jsx';
import CouponImport from './views/CouponImport.jsx';
import { SplitEditor, SplitHub, SplitShare } from './views/Split.jsx';

const ROUTES = [
  { path: '', label: 'Dashboard', icon: LayoutDashboard, view: Dashboard },
  { path: 'ledger', label: 'Ledger', icon: List, view: Ledger },
  { path: 'scan', label: 'Scan', icon: ScanLine, view: Scan },
  { path: 'split', label: 'Split', icon: SplitIcon, view: SplitHub },
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
    <a href="#/" className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="size-8" />
      <span className="text-lg font-extrabold tracking-tight">Bill<span className="text-brand">Khata</span></span>
    </a>
  );
}

function Sidebar({ route }) {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-slate-200 bg-white px-4 py-5 md:flex">
      <Logo />
      <a href="#/scan" className="mt-6 flex h-11 items-center justify-center gap-2 rounded-lg bg-brand font-semibold text-white shadow-sm hover:bg-brand-dark">
        <ScanLine className="size-5" />Scan a bill
      </a>
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
      <div className="mt-auto rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
        <ShieldCheck className="mb-1 size-4 text-emerald-700" />
        Your bills never leave this browser. Download a backup in Settings now and then.
      </div>
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
              <a key={path} href="#/scan" className="flex flex-col items-center" aria-current={active ? 'page' : undefined}>
                <span className="-mt-5 flex size-14 items-center justify-center rounded-full bg-brand text-white shadow-lg ring-4 ring-white">
                  <ScanLine className="size-6" />
                </span>
                <span className="mt-0.5 text-[11px] font-bold text-brand">Scan</span>
              </a>
            );
          }
          return (
            <a key={path} href={`#/${path}`} aria-current={active ? 'page' : undefined} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${active ? 'text-slate-900' : 'text-slate-500'}`}>
              <Icon className="size-5" strokeWidth={active ? 2.5 : 2} />{label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}

export default function App() {
  const route = useHashRoute();
  const { ready, loadError } = useStore();
  // #/coupon/<billId>/<code> comes back from the portal helper.
  const couponMatch = /^coupon\/([^/]+)\/(\d+)$/.exec(route);
  const shareMatch = /^split\/([A-Za-z0-9_-]+)$/.exec(route);
  const editMatch = /^split-bill\/(.+)$/.exec(route);
  let current;
  let viewProps = {};
  if (couponMatch) {
    current = { path: 'coupon', label: 'Save coupon', view: CouponImport };
    viewProps = { billId: decodeURIComponent(couponMatch[1]), code: couponMatch[2] };
  } else if (shareMatch) {
    current = { path: 'split', label: 'Shared split', view: SplitShare };
    viewProps = { token: shareMatch[1] };
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
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:hidden">
        <Logo />
      </header>
      <main className="px-4 pb-28 pt-5 md:ml-60 md:px-8 md:pb-10 md:pt-8">
        <div className="mx-auto max-w-6xl">
          {loadError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              Could not open local storage: {loadError} Bills will not be saved in this window.
            </div>
          )}
          {ready ? <View key={route} {...viewProps} /> : <div className="py-20 text-center text-slate-500">Loading your bills…</div>}
        </div>
      </main>
      <BottomNav route={current.path} />
      <ModalHost />
    </div>
  );
}
