import { createContext, useCallback, useContext, useState } from 'react';
import { CircleAlert, CircleCheck, X } from 'lucide-react';

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  // `action`: { label, run }, a button on the toast (Undo), which then stays a little longer.
  const toast = useCallback((message, kind = 'success', { action } = {}) => {
    const id = Math.random().toString(36).slice(2);
    // The same message again (copying several fields) replaces the old one instead of stacking.
    // Only the newest Undo stays, so an older one can't be tapped by mistake.
    setToasts((t) => [...t.filter((x) => x.message !== message && !(action && x.action)), { id, message, kind, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' || action ? 6000 : 3200);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-pos pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${t.kind === 'error' ? 'bg-brand' : 'bg-slate-900'}`}
          >
            {t.kind === 'error' ? <CircleAlert className="mt-0.5 size-4 shrink-0" /> : <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-400" />}
            <span className="flex-1">{t.message}</span>
            {t.action && (
              <button type="button" onClick={() => { t.action.run(); setToasts((x) => x.filter((y) => y.id !== t.id)); }} className="-my-1 shrink-0 rounded px-2 py-1 font-semibold underline underline-offset-2">
                {t.action.label}
              </button>
            )}
            <button type="button" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} aria-label="Dismiss" className="-my-1 -mr-1 rounded p-1">
              <X className="size-4 opacity-70" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
