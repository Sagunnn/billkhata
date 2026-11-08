// When a screen hits a bug, show what happened and a way out instead of a blank app: try again,
// go Home, reload, or download all your data. A page file missing after an update reloads once.
import { Component, useState } from 'react';
import { CircleAlert, Download, House, RefreshCw, RotateCcw } from 'lucide-react';
import { downloadEverything, isChunkError, reloadForUpdate } from '../lib/emergency.js';

function CrashCard({ error, scope, onRetry, onHome }) {
  const [saved, setSaved] = useState('');
  const chunk = isChunkError(error);
  const save = async () => {
    try { const n = await downloadEverything(); setSaved(`Downloaded: ${n} bills and everything else. Keep the file safe; Settings → Restore brings it back.`); } catch (e) { setSaved(`Couldn’t download: ${e.message}`); }
  };
  const btn = 'tap inline-flex h-11 items-center justify-center gap-2 rounded-[12px] px-4 text-[15px] font-medium';
  return (
    <div role="alert" className="mx-auto my-6 max-w-md rounded-[20px] border border-line bg-surface p-5 text-ink shadow-sm">
      <p className="flex items-center gap-2 text-[18px] font-semibold"><CircleAlert className="size-5 text-danger" />{chunk ? 'This page needs the latest version' : scope === 'window' ? 'This window hit a problem' : 'Something went wrong on this page'}</p>
      <p className="t-body mt-2 text-ink-2">
        {chunk ? 'BillKhata was updated while it was open. Reload to get the new version.' : 'Your bills are safe: they’re saved on this device. Try again, or go back Home.'}
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {chunk
          ? <button type="button" className={`${btn} bg-brand text-on-brand sm:col-span-2`} onClick={() => window.location.reload()}><RefreshCw className="size-4" />Reload</button>
          : (
            <>
              <button type="button" className={`${btn} bg-brand text-on-brand`} onClick={onRetry}><RotateCcw className="size-4" />Try again</button>
              <button type="button" className={`${btn} border border-line-strong`} onClick={onHome}><House className="size-4" />{scope === 'window' ? 'Close it' : 'Back to Home'}</button>
            </>
          )}
        <button type="button" className={`${btn} border border-line-strong sm:col-span-2`} onClick={save}><Download className="size-4" />Download all my data</button>
      </div>
      {saved && <p className="t-caption mt-2 text-ink-2">{saved}</p>}
      <details className="mt-3">
        <summary className="t-caption cursor-pointer text-ink-3">Details for a bug report</summary>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-[10px] bg-sunken p-2 text-[11px] text-ink-2">{String(error?.stack || error?.message || error).slice(0, 2000)}</pre>
      </details>
    </div>
  );
}

/**
 * `scope`: 'page' (a route: Home goes to #/), 'window' (a sheet: Close calls onClose), or 'app'
 * (everything: Home reloads the app at #/). Changing `resetKey` (the route) clears the error.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, key: props.resetKey };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error, info) {
    console.error('BillKhata:', error, info?.componentStack);
    if (isChunkError(error)) reloadForUpdate();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { scope = 'page', onClose } = this.props;
    const retry = () => this.setState({ error: null });
    const home = () => {
      this.setState({ error: null });
      if (scope === 'window') onClose?.();
      else if (scope === 'app') { window.location.hash = '#/'; window.location.reload(); }
      else window.location.hash = '#/';
    };
    const card = <CrashCard error={error} scope={scope} onRetry={retry} onHome={home} />;
    if (scope === 'window') return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">{card}</div>;
    if (scope === 'app') return <div className="min-h-dvh bg-canvas px-4 pt-10">{card}</div>;
    return card;
  }
}
