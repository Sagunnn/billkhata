// The bill photo with pan and zoom, for checking the read fields against the paper.
// Touch: pinch, double-tap, drag when zoomed. Mouse: double-click, Ctrl/⌘ + scroll, drag.
// Keyboard: + and − zoom, 0 fits, arrows pan.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minus, Plus, Shrink } from 'lucide-react';

const MAX = 6;
const STEP = 1.6;
const coarse = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

export function ReceiptViewer({ src, alt = 'Bill photo', className = '', onExpand }) {
  const box = useRef(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [gesturing, setGesturing] = useState(false);
  const live = useRef(view);
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });

  useEffect(() => { live.current = view; }, [view]);
  useEffect(() => setView({ s: 1, x: 0, y: 0 }), [src]);

  // Keep the photo covering the box: no panning past its edges, no zooming out below fit.
  const fit = useCallback((s, x, y) => {
    const el = box.current;
    if (!el) return { s: 1, x: 0, y: 0 };
    const ns = Math.min(MAX, Math.max(1, s));
    const w = el.clientWidth;
    const h = el.clientHeight;
    return { s: ns, x: Math.min(0, Math.max(w * (1 - ns), x)), y: Math.min(0, Math.max(h * (1 - ns), y)) };
  }, []);

  const zoomAt = useCallback((factor, cx, cy) => {
    setView((p) => {
      const ns = Math.min(MAX, Math.max(1, p.s * factor));
      const r = ns / p.s;
      return fit(ns, cx - (cx - p.x) * r, cy - (cy - p.y) * r);
    });
  }, [fit]);

  const centre = () => {
    const el = box.current;
    return el ? [el.clientWidth / 2, el.clientHeight / 2] : [0, 0];
  };
  const local = (e) => {
    const r = box.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  // Wheel needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      const zoomed = live.current.s > 1;
      if (!(e.ctrlKey || e.metaKey) && !zoomed) return; // plain scroll at fit: scroll the page
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else setView((p) => fit(p.s, p.x - e.deltaX, p.y - e.deltaY));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [fit, zoomAt]);

  function startGesture() {
    const pts = [...pointers.current.values()];
    const p = live.current;
    if (pts.length >= 2) {
      const [a, b] = pts;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      gesture.current = { type: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mid0: mid, ...p, moved: true };
    } else if (pts.length === 1) {
      gesture.current = { type: 'pan', start: pts[0], ...p, moved: false };
    } else gesture.current = null;
  }

  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    box.current.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    setGesturing(true);
    startGesture();
  }

  function onPointerMove(e) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e));
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (g.type === 'pinch' && pts.length >= 2) {
      const [a, b] = pts;
      const ns = Math.min(MAX, Math.max(1, (g.s * Math.hypot(a[0] - b[0], a[1] - b[1])) / g.d0));
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      // The photo point that was under the fingers stays under them.
      const qx = (g.mid0[0] - g.x) / g.s;
      const qy = (g.mid0[1] - g.y) / g.s;
      setView(fit(ns, mid[0] - qx * ns, mid[1] - qy * ns));
    } else if (g.type === 'pan') {
      const [px, py] = pts[0];
      const dx = px - g.start[0];
      const dy = py - g.start[1];
      if (Math.hypot(dx, dy) > 6) g.moved = true;
      if (g.s > 1) setView(fit(g.s, g.x + dx, g.y + dy));
    }
  }

  function onPointerUp(e) {
    const g = gesture.current;
    const at = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size) { startGesture(); return; }
    setGesturing(false);
    gesture.current = null;
    // Double-tap / double-click: zoom in on that spot, or back to fit.
    if (g?.type === 'pan' && !g.moved && at) {
      const now = Date.now();
      const prev = lastTap.current;
      if (now - prev.t < 320 && Math.hypot(at[0] - prev.x, at[1] - prev.y) < 30) {
        if (live.current.s > 1) setView({ s: 1, x: 0, y: 0 });
        else zoomAt(2.5, at[0], at[1]);
        lastTap.current = { t: 0, x: 0, y: 0 };
      } else lastTap.current = { t: now, x: at[0], y: at[1] };
    }
  }

  function onKeyDown(e) {
    const [cx, cy] = centre();
    const pan = 60;
    const moves = { ArrowLeft: [pan, 0], ArrowRight: [-pan, 0], ArrowUp: [0, pan], ArrowDown: [0, -pan] };
    if (e.key === '+' || e.key === '=') zoomAt(STEP, cx, cy);
    else if (e.key === '-') zoomAt(1 / STEP, cx, cy);
    else if (e.key === '0') setView({ s: 1, x: 0, y: 0 });
    else if (moves[e.key] && live.current.s > 1) setView((p) => fit(p.s, p.x + moves[e.key][0], p.y + moves[e.key][1]));
    else return;
    e.preventDefault();
  }

  const zoomed = view.s > 1.01;
  const ctl = 'tap flex size-9 items-center justify-center rounded-md bg-slate-900/75 text-white backdrop-blur hover:bg-slate-900 disabled:opacity-40';

  return (
    <div className={`relative overflow-hidden bg-slate-100 ${className}`}>
      <div
        ref={box}
        role="group"
        aria-label={`${alt}. Use + and − to zoom, arrow keys to move.`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className={`absolute inset-0 select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy ${zoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
        style={{ touchAction: zoomed ? 'none' : 'pan-y' }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className={`pointer-events-none absolute inset-0 size-full origin-top-left object-contain will-change-transform ${gesturing ? '' : 'transition-transform duration-150 ease-out'}`}
          style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.s})` }}
        />
      </div>
      {!zoomed && (
        <span className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-slate-900/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
          {coarse() ? 'Pinch or double-tap to zoom' : 'Double-click or Ctrl + scroll to zoom'}
        </span>
      )}
      <div className="absolute bottom-2 right-2 flex gap-1.5">
        <button type="button" className={ctl} aria-label="Zoom out" disabled={!zoomed} onClick={() => zoomAt(1 / STEP, ...centre())}><Minus className="size-4" /></button>
        <button type="button" className={ctl} aria-label="Zoom in" disabled={view.s >= MAX} onClick={() => zoomAt(STEP, ...centre())}><Plus className="size-4" /></button>
        {zoomed && <button type="button" className={ctl} aria-label="Fit the whole bill" onClick={() => setView({ s: 1, x: 0, y: 0 })}><Shrink className="size-4" /></button>}
        {onExpand && <button type="button" className={ctl} aria-label="Open full screen" onClick={onExpand}><Maximize2 className="size-4" /></button>}
      </div>
    </div>
  );
}
