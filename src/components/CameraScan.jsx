// Live in-app camera (Figma: Phone 02 · Scan). The back camera fills the screen; each preview frame
// is checked for a bill (a bright sheet on a darker table) so the brackets follow it. You take the
// photo with the shutter (never by itself: the camera may not have focused yet); it's cropped to the
// paper and checked for blur, and a blurry one asks to be taken again. Nothing leaves the phone.
// Without camera access, the phone's own camera app is used instead.
import { useEffect, useRef, useState } from 'react';
import { Camera, Image as ImageIcon, ReceiptText, ShieldCheck, X, Zap, ZapOff } from 'lucide-react';
import { findPaper, isBill, toGray } from '../lib/paperEdge.js';
import { BLURRY_FOCUS, photoFocus } from '../lib/image.js';

const PREVIEW_W = 160; // frames are checked at this width
/** The bill's box from a preview frame, scaled to the full video, with a small margin. */
function cropFrom(video, box, pw, ph) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const k = vw / pw;
  const m = 0.02;
  let x = Math.max(0, (box.x - box.w * m) * k);
  let y = Math.max(0, (box.y - box.h * m) * (vh / ph));
  let w = Math.min(vw - x, box.w * (1 + 2 * m) * k);
  let h = Math.min(vh - y, box.h * (1 + 2 * m) * (vh / ph));
  if (w < vw * 0.2 || h < vh * 0.2) { x = 0; y = 0; w = vw; h = vh; }
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  c.getContext('2d').drawImage(video, x, y, w, h, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.92);
}

export default function CameraScan({ title = 'Scan a bill', onPhoto, onFile, onPdfOrFile, onTypeIt, onSample, onClose }) {
  const video = useRef(null);
  const upload = useRef(null);
  const fallback = useRef(null);
  const [state, setState] = useState('starting'); // starting | live | found | taking | blurry | denied | none
  const [shot, setShot] = useState(''); // the photo just taken, while it's checked or shown as blurry
  const [box, setBox] = useState(null); // in preview pixels, for the brackets
  const [size, setSize] = useState({ w: PREVIEW_W, h: 200 });
  const [torch, setTorch] = useState(null); // null: not available; else on/off
  const stream = useRef(null);
  const tickRef = useRef(null);
  const taken = useRef(false);
  const onPhotoRef = useRef(onPhoto);
  onPhotoRef.current = onPhoto;

  useEffect(() => {
    let stop = false;
    let timer = 0;
    const canvas = document.createElement('canvas');
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setState('none'); return; }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
        if (stop) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        video.current.srcObject = s;
        await video.current.play();
        const track = s.getVideoTracks()[0];
        const caps = track?.getCapabilities?.() || {};
        if (caps.torch) setTorch(false);
        // Keep refocusing as the phone moves, where the browser allows it.
        if (caps.focusMode?.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        setState('live');
        tick();
      } catch {
        setState('denied');
      }
    }
    function tick() {
      if (stop || taken.current) return;
      const v = video.current;
      if (v && v.videoWidth) {
        const w = PREVIEW_W;
        const h = Math.round((v.videoHeight / v.videoWidth) * w);
        canvas.width = w;
        canvas.height = h;
        const g = canvas.getContext('2d', { willReadFrequently: true });
        g.drawImage(v, 0, 0, w, h);
        const found = findPaper(toGray(g.getImageData(0, 0, w, h).data), w, h);
        const ok = isBill(found);
        setSize({ w, h });
        setBox(ok ? found : null);
        setState(ok ? 'found' : 'live');
      }
      timer = setTimeout(tick, 180);
    }
    tickRef.current = tick;
    start();
    return () => {
      stop = true;
      clearTimeout(timer);
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function take() {
    const v = video.current;
    if (!v?.videoWidth || taken.current) return;
    taken.current = true;
    setState('taking');
    navigator.vibrate?.(30);
    const url = cropFrom(v, box || { x: 0, y: 0, w: size.w, h: size.h }, size.w, size.h);
    setShot(url);
    let sharp = Infinity;
    try { sharp = await photoFocus(url); } catch { /* can't measure: use it */ }
    if (sharp < BLURRY_FOCUS) { setState('blurry'); return; }
    use(url);
  }

  function use(url) {
    stream.current?.getTracks().forEach((t) => t.stop());
    onPhotoRef.current(url);
  }

  function retake() {
    setShot('');
    taken.current = false;
    setState('live');
    tickRef.current?.();
  }

  async function flash() {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch); } catch { setTorch(null); }
  }

  const pickFile = (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); };
  const noCamera = state === 'denied' || state === 'none';
  const pill = {
    starting: 'Starting the camera',
    live: 'Point at a bill',
    found: 'Bill found · tap the button',
    taking: 'Checking the photo',
  }[state];
  // Brackets: around the bill when found (mapped through the video's object-cover crop), else a
  // default frame.
  let frame = { left: '10%', top: '14%', width: '80%', height: '64%' };
  const v = video.current;
  if (box && v?.videoWidth && v.clientWidth) {
    const scale = Math.max(v.clientWidth / v.videoWidth, v.clientHeight / v.videoHeight);
    const k = (v.videoWidth / size.w) * scale;
    const ox = (v.clientWidth - v.videoWidth * scale) / 2;
    const oy = (v.clientHeight - v.videoHeight * scale) / 2;
    frame = { left: box.x * k + ox, top: box.y * k + oy, width: box.w * k, height: box.h * k };
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#14110e] text-[#faf7f2]" role="dialog" aria-label={title}>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video ref={video} playsInline muted className={`absolute inset-0 size-full object-cover ${noCamera ? 'hidden' : ''}`} />
        {!noCamera && (
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute transition-all duration-200" style={frame}>
              {['left-0 top-0 border-l-4 border-t-4 rounded-tl-md', 'right-0 top-0 border-r-4 border-t-4 rounded-tr-md', 'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-md', 'bottom-0 right-0 border-b-4 border-r-4 rounded-br-md'].map((c) => (
                <span key={c} className={`absolute size-8 ${c} ${box ? 'border-[#f5c04a]' : 'border-white/70'}`} />
              ))}
            </div>
          </div>
        )}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pb-3 pt-[calc(var(--safe-top)+0.75rem)]">
          <button type="button" onClick={onClose} aria-label="Close the camera" className="tap flex size-10 items-center justify-center rounded-full bg-black/40"><X className="size-5" /></button>
          <span className="min-w-0 truncate px-2 text-[16px] font-semibold">{title}</span>
          {torch !== null
            ? <button type="button" onClick={flash} aria-pressed={torch} aria-label="Flash" className="tap flex size-10 items-center justify-center rounded-full bg-black/40">{torch ? <Zap className="size-5 text-[#f5c04a]" /> : <ZapOff className="size-5" />}</button>
            : <span className="size-10" />}
        </div>
        {pill && !noCamera && (
          <p className="absolute left-1/2 top-[calc(var(--safe-top)+4.25rem)] flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-black/60 px-4 py-2 text-[14px] font-medium" role="status">
            <span className={`size-2 rounded-full ${state === 'found' ? 'bg-[#f5c04a]' : 'bg-white/60'}`} />{pill}
          </p>
        )}
        {state === 'blurry' && shot && (
          <div className="absolute inset-0 flex flex-col bg-[#14110e]" role="alertdialog" aria-label="The photo looks blurry">
            <img src={shot} alt="The photo you took" className="min-h-0 flex-1 object-contain p-4 pt-[calc(var(--safe-top)+4rem)] opacity-90" />
            <div className="m-4 rounded-[18px] bg-[#27231d] p-4">
              <p className="text-[16px] font-semibold">This photo looks blurry</p>
              <p className="mt-1 text-[14px] text-white/70">Digits could be misread. Hold the phone steady, a little further from the bill, in good light, then tap the button.</p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={retake} className="tap h-11 flex-1 rounded-[12px] bg-[#b91c1c] text-[15px] font-semibold text-white">Take again</button>
                <button type="button" onClick={() => use(shot)} className="tap h-11 rounded-[12px] bg-white/10 px-4 text-[15px] font-medium">Use anyway</button>
              </div>
            </div>
          </div>
        )}
        {noCamera && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <Camera className="size-10 text-white/70" />
            <p className="text-[16px] font-semibold">{state === 'denied' ? 'Camera access is off' : 'No camera here'}</p>
            <p className="text-[14px] text-white/70">{state === 'denied' ? 'Allow the camera for this site in your browser settings, or take the photo with your phone’s camera app.' : 'Take the photo with your phone’s camera app, or pick a photo or PDF.'}</p>
            <button type="button" onClick={() => fallback.current?.click()} className="tap inline-flex h-12 items-center gap-2 rounded-[14px] bg-[#b91c1c] px-5 text-[15px] font-semibold text-white"><Camera className="size-5" />Use phone camera</button>
          </div>
        )}
      </div>

      <div className="shrink-0 bg-[#1c1915] px-4 pb-[calc(var(--safe-bottom)+1rem)] pt-4">
        <div className="flex justify-center gap-6 text-[14px] font-medium">
          <span className="text-[#f5c04a]">Photo</span>
          <button type="button" onClick={onPdfOrFile} className="text-white/70 hover:text-white">PDF or photo file</button>
          <button type="button" onClick={onTypeIt} className="text-white/70 hover:text-white">Type it</button>
        </div>
        <div className="mx-auto mt-4 flex max-w-sm items-center justify-between">
          <button type="button" onClick={() => upload.current?.click()} className="tap flex w-20 flex-col items-center gap-1.5 text-[12px] text-white/80">
            <span className="flex size-12 items-center justify-center rounded-[14px] bg-white/10"><ImageIcon className="size-5" /></span>Upload
          </button>
          <button type="button" onClick={() => (noCamera ? fallback.current?.click() : take())} disabled={state === 'starting' || state === 'taking' || state === 'blurry'}
            aria-label="Take the photo" className="tap flex size-[76px] items-center justify-center rounded-full border-4 border-white disabled:opacity-50">
            <span className="size-[60px] rounded-full bg-white" />
          </button>
          <button type="button" onClick={onSample} className="tap flex w-20 flex-col items-center gap-1.5 text-[12px] text-white/80">
            <span className="flex size-12 items-center justify-center rounded-[14px] bg-white/10"><ReceiptText className="size-5" /></span>Try a sample
          </button>
        </div>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-white/60">
          <ShieldCheck className="size-3.5" />Read on this phone. Nothing is uploaded.
          {!noCamera && <button type="button" onClick={() => fallback.current?.click()} className="ml-1 underline">Use phone camera</button>}
        </p>
      </div>
      <input ref={upload} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={pickFile} />
      <input ref={fallback} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={pickFile} />
    </div>
  );
}
