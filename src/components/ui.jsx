// Shared building blocks, styled after the Figma component library (BillKhata Redesign → Components).
import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, Check, CircleAlert, CircleCheck, CircleX, Copy, FileCheck2, Info, Link2, QrCode, ScanText, Send, Ticket, TriangleAlert, Trophy, X } from 'lucide-react';
import { IRD_STATUS } from '../lib/constants.js';
import { copyText } from '../lib/format.js';
import { useToast } from './Toast.jsx';

// Primary (sindoor) is the one main action per screen; secondary for the rest; tonal for a red
// action that isn't the main one; ghost for quiet text buttons. Disabled is sunken, never faded red.
const VARIANTS = {
  primary: 'bg-brand text-on-brand hover:bg-brand-dark',
  dark: 'bg-ink text-ink-inverse hover:opacity-90',
  outline: 'border border-line-strong bg-surface text-ink hover:bg-sunken',
  tonal: 'bg-brand-soft text-brand hover:bg-brand-soft/70',
  ghost: 'text-ink hover:bg-sunken',
  danger: 'border border-line-strong bg-surface text-danger hover:bg-danger-soft',
  copied: 'border border-emerald-300 bg-leaf-soft text-leaf',
};
const SIZES = {
  sm: 'h-9 px-3 text-[14px] font-medium gap-1.5 rounded-lg',
  md: 'h-10 px-3.5 text-[14px] font-medium gap-2 rounded-lg',
  lg: 'h-[52px] px-5 text-[15px] font-semibold gap-2 rounded-[14px]',
};

/** A keycap hint ("S"), pinned right inside a button or shown alone. Desktop only (≥1024px). */
export function Kbd({ children, tone = 'default', className = '' }) {
  const tones = {
    default: 'border border-line-strong bg-sunken text-ink-2',
    brand: 'bg-white/20 text-on-brand',
    dark: 'bg-white/15 text-ink-inverse',
    hero: 'bg-[rgba(255,255,255,0.15)] text-hero-ink',
  };
  return <kbd className={`kbd inline-flex min-w-[22px] items-center justify-center rounded px-1.5 py-0.5 font-mono text-[12px] font-medium leading-4 ${tones[tone]} ${className}`}>{children}</kbd>;
}

export function Button({ variant = 'outline', size = 'md', className = '', icon: Icon, shortcut, children, ...props }) {
  return (
    <button
      type="button"
      className={`tap relative inline-flex shrink-0 items-center justify-center transition disabled:cursor-not-allowed disabled:border-transparent disabled:bg-sunken disabled:text-ink-3 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {Icon && <Icon className={size === 'lg' ? 'size-5' : 'size-[18px]'} aria-hidden="true" />}
      {children}
      {shortcut && <Kbd tone={variant === 'primary' ? 'brand' : variant === 'dark' ? 'dark' : 'default'} className="absolute right-3 top-1/2 -translate-y-1/2">{shortcut}</Kbd>}
    </button>
  );
}

const BADGE_TONES = {
  neutral: 'bg-sunken text-ink-2',
  brand: 'bg-brand-soft text-brand',
  success: 'bg-leaf-soft text-leaf',
  warning: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-navy-soft text-navy',
  prize: 'bg-marigold-soft text-marigold-ink',
};

/** Status words, text first; colour only supports (Components → Badge). */
export function Badge({ tone = 'neutral', icon: Icon, children, className = '', title }) {
  return (
    <span title={title} className={`inline-flex items-center gap-[5px] whitespace-nowrap rounded-full py-[3px] pl-2 pr-[9px] text-[13px] font-medium leading-4 ${BADGE_TONES[tone]} ${className}`}>
      {Icon && <Icon className="size-[13px] shrink-0" aria-hidden="true" />}{children}
    </span>
  );
}

const NOTICE = {
  success: ['bg-leaf-soft', 'text-leaf', CircleCheck],
  info: ['bg-navy-soft', 'text-navy', Link2],
  warning: ['bg-warn-soft', 'text-warn', TriangleAlert],
  error: ['bg-danger-soft', 'text-danger', CircleX],
  prize: ['bg-marigold-soft', 'text-marigold-ink', Trophy],
};

/** Above the form, never a popup: what happened and the one thing to do next (Components → Notice). */
export function Notice({ tone = 'info', title, children, action, icon, className = '', role = 'status' }) {
  const [bg, fg, DefaultIcon] = NOTICE[tone];
  const Icon = icon || DefaultIcon;
  return (
    <div role={role} className={`flex items-start gap-3 rounded-[14px] px-3.5 py-3 ${bg} ${className}`}>
      <Icon className={`mt-px size-5 shrink-0 ${fg}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className="t-body font-semibold text-ink">{title}</p>}
        {children && <div className="t-label text-ink-2">{children}</div>}
        {action && <div className="pt-1.5">{action}</div>}
      </div>
    </div>
  );
}

/** A small rounded action inside a notice ("Re-scan with Vision AI"). */
export function ActionChip({ icon: Icon, children, className = '', ...props }) {
  return (
    <button type="button" className={`tap inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-raised px-3 py-[7px] text-[14px] font-medium text-ink hover:bg-sunken disabled:opacity-60 ${className}`} {...props}>
      {Icon && <Icon className="size-3.5" aria-hidden="true" />}{children}
    </button>
  );
}

/** Filter and quick-pick chip, 36px tall (Components → Chip). */
export function Chip({ selected, icon: Icon, children, className = '', ...props }) {
  return (
    <button type="button" aria-pressed={selected} className={`chip tap ${className}`} {...props}>
      {selected ? <Check className="size-4" aria-hidden="true" /> : Icon && <Icon className="size-4" aria-hidden="true" />}{children}
    </button>
  );
}

export function Field({ label, error, hint, htmlFor, children, className = '' }) {
  return (
    <div className={className}>
      {label && <label className="label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? (
        <p id={htmlFor && `${htmlFor}-hint`} className="mt-1 flex items-center gap-1 text-[12px] font-medium leading-4 text-danger"><CircleAlert className="size-3.5" />{error}</p>
      ) : hint ? (
        <p id={htmlFor && `${htmlFor}-hint`} className="mt-1 text-[12px] leading-4 text-ink-3">{hint}</p>
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
        <h1 className="t-h-l text-ink">{title}</h1>
        {subtitle && <p className="t-label mt-1 text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const STATUS_STYLE = {
  [IRD_STATUS.NOT_APPLIED]: ['brand', Ticket, 'Apply to IRD'],
  [IRD_STATUS.APPLIED]: ['success', BadgeCheck, 'Coupon saved'],
  [IRD_STATUS.AUTO]: ['info', QrCode, 'Auto-entered via QR'],
  [IRD_STATUS.INELIGIBLE]: ['neutral', X, 'Not eligible'],
};

export function StatusBadge({ status, className = '', label }) {
  const [tone, Icon, text] = STATUS_STYLE[status] || STATUS_STYLE[IRD_STATUS.INELIGIBLE];
  return <Badge tone={tone} icon={Icon} className={className}>{label || text}</Badge>;
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
    <div className="overflow-hidden rounded-[14px] border border-line bg-sunken">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface py-1.5 pl-3 pr-1.5">
        <span className="t-overline text-ink-3">{title}</span>
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

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'lg' }) {
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#1c170f]/55 md:items-center md:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`sheet-max flex w-full flex-col rounded-t-2xl bg-surface shadow-lg outline-none md:rounded-2xl ${width}`}
      >
        {/* Sheet handle on phones */}
        <div className="flex justify-center pt-2 md:hidden" aria-hidden="true"><span className="h-1 w-10 rounded-full bg-line-strong" /></div>
        <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-2 md:pt-4">
          <div className="min-w-0">
            <h2 className="t-h-s text-ink">{title}</h2>
            {subtitle && <p className="t-label text-ink-2">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="tap -mr-1.5 flex size-10 items-center justify-center rounded-full border border-line bg-surface text-ink-2 hover:bg-sunken" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        {/* Sticky parts inside (the bill photo) stick to the top of this scroll area. */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-1" style={{ '--sticky-top': '-0.25rem' }}>{children}</div>
        {footer && <div className="pb-safe-3 flex flex-wrap justify-end gap-2 border-t border-line px-5 pt-3">{footer}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {Icon && <div className="mb-3 flex size-14 items-center justify-center rounded-2xl bg-sunken"><Icon className="size-7 text-ink-2" /></div>}
      <p className="t-h-s text-ink">{title}</p>
      {children && <p className="t-body mt-1 max-w-sm text-ink-2">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, id }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="t-body block font-semibold text-ink">{label}</span>
        {description && <span className="t-label mt-0.5 block text-ink-2">{description}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input id={id} type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-7 w-12 rounded-full bg-line-strong transition peer-checked:bg-leaf peer-focus-visible:ring-2 peer-focus-visible:ring-navy/40" />
        <span className="absolute left-0.5 top-0.5 size-6 rounded-full bg-raised shadow transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export function Segmented({ value, onChange, options, className = '' }) {
  return (
    <div className={`inline-flex rounded-[14px] bg-sunken p-1 ${className}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`tap inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 py-2 text-[14px] font-medium transition ${value === o.value ? 'bg-raised text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}
        >
          {o.icon && <o.icon className="size-4" aria-hidden="true" />}{o.label}
        </button>
      ))}
    </div>
  );
}

// Where a bill is in its life: read by the scanner, checked and saved, entered in the IRD draw.
const STAGES = {
  scanned: ['Scanned', 'info', ScanText, 'Read by the scanner. Check the fields against the photo, then save.'],
  verified: ['Verified', 'success', FileCheck2, 'You checked and saved this bill.'],
  submitted: ['Submitted', 'prize', Send, 'Entered in the IRD draw: the coupon number is saved.'],
};

export function StageBadge({ stage, className = '' }) {
  const s = STAGES[stage];
  if (!s) return null;
  const [label, tone, Icon, title] = s;
  return <Badge tone={tone} icon={Icon} className={className} title={title}>{label}</Badge>;
}

/** Hover / long-press explanation (Components → Tooltip). */
export function Tooltip({ text, children, className = '' }) {
  if (!text) return children;
  return (
    <span className={`group relative inline-flex ${className}`}>
      {children}
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-[10px] bg-inverse px-2.5 py-1.5 text-[13px] font-medium text-ink-inverse shadow-lg group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  );
}

export { Info };

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
