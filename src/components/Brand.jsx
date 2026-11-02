// The ख (kha) monogram on a sindoor tile, and the wordmark: Bill in ink, Khata in red.
export function LogoMark({ size = 36, className = '' }) {
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-[10px] bg-[#b91c1c] font-nepali font-semibold text-white ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.61, lineHeight: 1, borderRadius: size * 0.28 }}>
      <span style={{ marginTop: size * 0.06 }}>ख</span>
    </span>
  );
}

export function Wordmark({ size = 36 }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="font-semibold text-ink" style={{ fontSize: size * 0.5 }}>Bill<span className="text-[#b91c1c] dark:text-brand">Khata</span></span>
    </span>
  );
}
