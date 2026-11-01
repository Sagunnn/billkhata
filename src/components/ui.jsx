// Small shared UI building blocks.
import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, Check, CircleAlert, Copy, FileCheck2, QrCode, ScanText, Send, Ticket, X } from 'lucide-react';
import { IRD_STATUS } from '../lib/constants.js';
import { copyText } from '../lib/format.js';
import { useToast } from './Toast.jsx';

const VARIANTS = {
  primary: 'bg-brand text-white hover:bg-brand-dark shadow-sm',
  dark: 'bg-slate-900 text-white hover:bg-slate-800 shadow-sm',
  outline: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
  ghost: 'text-slate-700 hover:bg-slate-100',
  danger: 'border border-red-200 bg-white text-brand hover:bg-red-50',
  copied: 'border border-emerald-300 bg-emerald-50 text-emerald-800',
};
const SIZES = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-base gap-2',
};

export function Button({ variant = 'outline', size = 'md', className = '', icon: Icon, children, ...props }) {
  return (
    <button
      type="button"
      className={`tap inline-flex shrink-0 items-center justify-center rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {Icon && <Icon className={size === 'sm' ? 'size-4' : 'size-[18px]'} aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Field({ label, error, hint, htmlFor, children, className = '' }) {
  return (
    <div className={className}>
      {label && <label className="label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? (
        <p id={htmlFor && `${htmlFor}-hint`} className="mt-1 flex items-center gap-1 text-sm font-medium text-brand"><CircleAlert className="size-3.5" />{error}</p>
      ) : hint ? (
        <p id={htmlFor && `${htmlFor}-hint`} className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function Card({ className = '', children, ...props }) {
  return <section className={`card ${className}`} {...props}>{children}</section>;
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const STATUS_STYLE = {
  [IRD_STATUS.NOT_APPLIED]: ['bg-amber-100 text-amber-900 ring-amber-300', Ticket],
  [IRD_STATUS.APPLIED]: ['bg-emerald-100 text-emerald-900 ring-emerald-300', BadgeCheck],
  [IRD_STATUS.AUTO]: ['bg-blue-100 text-blue-900 ring-blue-300', QrCode],
  [IRD_STATUS.INELIGIBLE]: ['bg-slate-100 text-slate-600 ring-slate-300', X],
};

export function StatusBadge({ status, className = '' }) {
  const [style, Icon] = STATUS_STYLE[status] || STATUS_STYLE[IRD_STATUS.INELIGIBLE];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${style} ${className}`}>
      <Icon className="size-3.5" aria-hidden="true" />
      {status}
    </span>
  );
}

/** Copies `value`; the button turns into a checkmark and a toast confirms it. */
export function CopyButton({ value, label = 'Copy', copiedLabel = 'Copied', toastText = 'Copied to the clipboard.', className = '', size = 'sm', variant = 'outline', icon = Copy }) {
  const [done, setDone] = useState(false);
  const timer = useRef(0);
  const toast = useToast();
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Button
      size={size}
      variant={done ? 'copied' : variant}
      className={className}
      icon={done ? Check : icon}
      disabled={!value}
      onClick={async () => {
        if (await copyText(value)) {
          setDone(true);
          if (toastText) toast(toastText);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setDone(false), 1800);
        } else toast('Could not copy. Select the text and copy it by hand.', 'error');
      }}
    >
      {done ? copiedLabel : label}
    </Button>
  );
}

/**
 * Text to paste somewhere else, in a monospaced box with one Copy button.
 * `rows` ([label, value] pairs) are shown as aligned columns; `value` is what gets copied.
 */
export function PayloadBlock({ title, value, rows, toastText, copyLabel = 'Copy' }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-300 bg-slate-50">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white py-1.5 pl-3 pr-1.5">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</span>
        <CopyButton value={value} label={copyLabel} toastText={toastText} />
      </div>
      {rows ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 px-3 py-2.5 font-mono text-[13px] leading-5">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-500">{k}</dt>
              <dd className={`break-words ${v ? 'text-slate-900' : 'text-brand'}`}>{v || 'missing'}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all px-3 py-2.5 font-mono text-[12px] leading-5 text-slate-800">{value}</pre>
      )}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'lg' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  const width = { md: 'md:max-w-lg', lg: 'md:max-w-2xl', xl: 'md:max-w-4xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 md:items-center md:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`sheet-max flex w-full flex-col rounded-t-2xl bg-white shadow-2xl outline-none md:rounded-2xl ${width}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="tap -mr-1.5 flex items-center justify-center rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        {/* Sticky parts inside (the bill photo) stick to the top of this scroll area. */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4" style={{ '--sticky-top': '-1rem' }}>{children}</div>
        {footer && <div className="pb-safe-3 flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 pt-3">{footer}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {Icon && <div className="mb-3 rounded-full bg-slate-100 p-3"><Icon className="size-6 text-slate-500" /></div>}
      <p className="font-semibold text-slate-900">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-slate-600">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, id }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-slate-500">{description}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input id={id} type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-navy peer-focus-visible:ring-2 peer-focus-visible:ring-navy/40" />
        <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export function Segmented({ value, onChange, options, className = '' }) {
  return (
    <div className={`inline-flex rounded-lg border border-slate-300 bg-white p-0.5 ${className}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`tap rounded-md px-3 py-1.5 text-sm font-semibold transition ${value === o.value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Where a bill is in its life: read by the scanner, checked and saved, entered in the IRD draw.
const STAGES = {
  scanned: ['Scanned', 'bg-amber-50 text-amber-900 ring-amber-300', ScanText, 'Read by the scanner. Check the fields against the photo, then save.'],
  verified: ['Verified', 'bg-emerald-50 text-emerald-900 ring-emerald-300', FileCheck2, 'You checked and saved this bill.'],
  submitted: ['Submitted', 'bg-blue-50 text-blue-900 ring-blue-300', Send, 'Entered in the IRD draw: the coupon number is saved.'],
};

export function StageBadge({ stage, className = '' }) {
  const s = STAGES[stage];
  if (!s) return null;
  const [label, style, Icon, title] = s;
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${style} ${className}`}>
      <Icon className="size-3.5" aria-hidden="true" />{label}
    </span>
  );
}

/** Grey placeholder blocks shown while data loads. */
export const Skeleton = ({ className = '' }) => <div className={`skeleton ${className}`} aria-hidden="true" />;

/**
 * Drag-and-drop of files onto an element: spread `props` on it, show `dragging` as a highlight.
 * Only drags that carry files count, so dragging text or a link around the page does nothing.
 */
export function useFileDrop(onFiles) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const props = {
    onDragEnter: (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current += 1; setDragging(true); },
    onDragOver: (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
    onDragLeave: (e) => { if (!hasFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); },
    onDrop: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth.current = 0;
      setDragging(false);
      const files = [...(e.dataTransfer.files || [])];
      if (files.length) onFiles(files);
    },
  };
  return [dragging, props];
}
