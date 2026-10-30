// Receive-payment QR: the display box used in splits, and the Settings section that sets it up.
import { useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, Crop, ImagePlus, QrCode, Smartphone, Trash } from 'lucide-react';
import { fileToDataUrl, validateImageFile } from '../lib/image.js';
import { compressQrCanvas, decodeQrFromImage, loadImage, paymentQrInfo, qrKind, qrSvg } from '../lib/qr.js';
import { loadPaymentQr, savePaymentQr } from '../lib/profile.js';
import { useStore } from '../store.jsx';
import { useToast } from './Toast.jsx';
import { Button, Card, Field, Segmented } from './ui.jsx';

/** Renders a QR from text (crisp SVG) or shows the uploaded picture. */
export function QrBox({ text, image, label, size = 200 }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let live = true;
    if (text) qrSvg(text).then((s) => live && setSvg(s)).catch(() => live && setSvg(''));
    else setSvg('');
    return () => { live = false; };
  }, [text]);
  return (
    <figure className="inline-flex flex-col items-center gap-2">
      <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm" style={{ width: size, height: size }}>
        {svg
          // SVG markup comes from the qrcode library, built from our own text.
          ? <div className="size-full [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
          : image ? <img src={image} alt="Payment QR" className="size-full object-contain" /> : <QrCode className="size-full text-slate-200" />}
      </div>
      {label && <figcaption className="text-center text-sm font-semibold text-slate-700">{label}</figcaption>}
    </figure>
  );
}

/** Whether the saved QR can carry an amount (EMVCo tag 54 / eSewa "amount"). */
const KIND_NOTES = {
  emv: [true, 'NepalQR / mobile-banking QR read correctly (checksum OK).'],
  'emv-invalid': [false, 'This looks like a NepalQR code but its checksum is wrong, so it may have been misread. Try a sharper, tighter crop.'],
  esewa: [true, 'eSewa QR read.'],
  other: [true, 'QR read.'],
  '': [false, 'This QR couldn’t be read, but the image will still show. If it doesn’t scan, try a sharper, tighter crop.'],
};
function QrKindNote({ text }) {
  const [ok, note] = KIND_NOTES[qrKind(text || '')] || KIND_NOTES.other;
  return (
    <p className={`flex gap-1.5 text-sm ${ok ? 'text-emerald-800' : 'text-amber-900'}`}>
      {ok ? <CircleCheck className="mt-0.5 size-4 shrink-0" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" />}{note}
    </p>
  );
}

/** The payer's QR as configured in Settings, or null. */
export function usePaymentQr() {
  const { profile } = useStore();
  const [config, setConfig] = useState(loadPaymentQr);
  useEffect(() => {
    const on = () => setConfig(loadPaymentQr());
    window.addEventListener('billkhata-qr', on);
    return () => window.removeEventListener('billkhata-qr', on);
  }, []);
  return paymentQrInfo(config, profile);
}

/** Square crop with drag-to-move and a zoom slider, so a screenshot of a bank app becomes just the QR. */
function QrCropper({ src, onDone, onCancel }) {
  const VIEW = 280;
  const canvasRef = useRef(null);
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef(null);

  useEffect(() => { loadImage(src).then(setImg); }, [src]);
  const base = img ? VIEW / Math.min(img.naturalWidth, img.naturalHeight) : 1;

  useEffect(() => {
    if (!img) return;
    const g = canvasRef.current.getContext('2d');
    const s = base * zoom;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, VIEW, VIEW);
    g.drawImage(img, (VIEW - img.naturalWidth * s) / 2 + off.x, (VIEW - img.naturalHeight * s) / 2 + off.y, img.naturalWidth * s, img.naturalHeight * s);
  }, [img, zoom, off, base]);

  function finish() {
    // Re-draw the same window at 600 px for a sharp, readable QR.
    const OUT = 600;
    const k = OUT / VIEW;
    const s = base * zoom * k;
    const c = document.createElement('canvas');
    c.width = OUT;
    c.height = OUT;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, OUT, OUT);
    g.drawImage(img, (OUT - img.naturalWidth * s) / 2 + off.x * k, (OUT - img.naturalHeight * s) / 2 + off.y * k, img.naturalWidth * s, img.naturalHeight * s);
    onDone(c);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Drag and zoom so the QR fills the square.</p>
      <canvas
        ref={canvasRef}
        width={VIEW}
        height={VIEW}
        className="touch-none cursor-grab rounded-lg border-2 border-navy"
        onPointerDown={(e) => { drag.current = { x: e.clientX - off.x, y: e.clientY - off.y }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current) setOff({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }); }}
        onPointerUp={() => { drag.current = null; }}
      />
      <label className="flex max-w-[280px] items-center gap-3 text-sm font-semibold text-slate-700">
        Zoom
        <input type="range" min="1" max="5" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-navy" />
      </label>
      <div className="flex gap-2">
        <Button variant="dark" icon={Crop} onClick={finish} disabled={!img}>Use this</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export function PaymentQrSettings() {
  const { profile } = useStore();
  const toast = useToast();
  const [config, setConfig] = useState(loadPaymentQr);
  const [cropSrc, setCropSrc] = useState('');
  const [busy, setBusy] = useState(false);
  const info = paymentQrInfo(config, profile);

  function save(next) {
    setConfig(next);
    savePaymentQr(next);
    window.dispatchEvent(new Event('billkhata-qr'));
  }

  async function onFile(file) {
    const err = validateImageFile(file);
    if (err) return toast(err, 'error');
    setCropSrc(await fileToDataUrl(file));
  }

  async function onCropped(canvas) {
    setBusy(true);
    try {
      const image = compressQrCanvas(canvas);
      // Read the QR from the full-resolution crop first, then from the stored copy.
      const text = (await decodeQrFromImage(canvas)) || (await decodeQrFromImage(image));
      save({ mode: 'image', image, text, label: config.label || '' });
      setCropSrc('');
      toast(text ? 'QR saved and read.' : 'QR image saved, but it couldn’t be read, so amounts can’t be filled in.', text ? 'success' : 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4 md:p-5">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold"><QrCode className="size-5" />Receive payments (Split Khata)</h2>
      <p className="mb-4 text-sm text-slate-600">The QR friends scan to pay you back, shown with each person’s amount in the split screen and on the summary image. They type the amount after scanning. Stored only in this browser.</p>
      <Segmented
        value={config.mode || ''}
        onChange={(mode) => save({ ...config, mode })}
        options={[{ value: '', label: 'Off' }, { value: 'esewa', label: 'eSewa QR from profile' }, { value: 'image', label: 'Upload my QR' }]}
      />

      <div className="mt-4 grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-3">
          {config.mode === 'esewa' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="eSewa ID (mobile)" htmlFor="qr-esewa" hint={`Default: ${profile.phone || 'your profile mobile'}`}>
                  <input id="qr-esewa" inputMode="tel" className="input num" value={config.esewaId ?? ''} placeholder={profile.phone} onChange={(e) => save({ ...config, esewaId: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
                </Field>
                <Field label="Name" htmlFor="qr-name" hint={`Default: ${profile.fullName || 'your profile name'}`}>
                  <input id="qr-name" className="input" value={config.name ?? ''} placeholder={profile.fullName} onChange={(e) => save({ ...config, name: e.target.value.slice(0, 80) })} />
                </Field>
              </div>
              <p className="flex gap-1.5 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-950 ring-1 ring-inset ring-amber-200">
                <Smartphone className="mt-px size-3.5 shrink-0" />
                eSewa doesn’t publish its QR format, so this one is a guess ({'{"eSewa_id":"…","name":"…"}'}). Scan it once with another phone’s eSewa app; if it doesn’t open your account, use “Upload my QR” with the QR from your eSewa app.
              </p>
            </>
          )}
          {config.mode === 'image' && (
            cropSrc ? <QrCropper src={cropSrc} onDone={onCropped} onCancel={() => setCropSrc('')} /> : (
              <>
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800">
                    <ImagePlus className="size-4" />{config.image ? 'Replace QR image' : 'Upload QR image'}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                  {config.image && <Button variant="danger" icon={Trash} onClick={() => save({ mode: 'image' })}>Remove</Button>}
                </div>
                <p className="text-xs text-slate-500">A screenshot of the “My QR” / “Receive money” screen in your bank, Fonepay, eSewa or Khalti app. You can crop it next; it’s kept under 100 KB.</p>
                <Field label="Label under the QR" htmlFor="qr-label" hint="e.g. “NIC Asia · Sagun Pradhan” or “Khalti 98…”">
                  <input id="qr-label" className="input" value={config.label || ''} onChange={(e) => save({ ...config, label: e.target.value.slice(0, 60) })} />
                </Field>
                {config.image && <QrKindNote text={config.text} />}
              </>
            )
          )}
          {!config.mode && <p className="text-sm text-slate-600">Turn on a payment QR to show it in splits and on summary images.</p>}
          {busy && <p className="text-sm text-slate-500">Reading the QR…</p>}
        </div>
        {info && !cropSrc && <QrBox text={info.text} image={info.image} label={info.label} size={180} />}
      </div>
    </Card>
  );
}
