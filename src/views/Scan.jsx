// Capture -> OCR -> verify -> save.
import { useState } from 'react';
import { Camera, FileText, LoaderCircle, PencilLine, RotateCcw, Save, ScanText, Sparkles, Ticket, Upload } from 'lucide-react';
import { IRD_STATUS, OCR_ENGINES, VISION_PROVIDERS } from '../lib/constants.js';
import { blankExpense, validateExpense } from '../lib/expense.js';
import { compressImage, fileToDataUrl, prepareForOcr, validateImageFile } from '../lib/image.js';
import { getIrdStatus } from '../lib/ird.js';
import { extractBill } from '../lib/ocr/index.js';
import { sampleReceiptForScan } from '../lib/sample.js';
import { useStore } from '../store.jsx';
import BillForm from '../components/BillForm.jsx';
import { photoFromFile, PhotoViewer } from '../components/Modals.jsx';
import { useToast } from '../components/Toast.jsx';
import { Button, Card, PageHeader } from '../components/ui.jsx';

const STATUS_TEXT = {
  'loading tesseract core': 'Loading the text reader',
  'initializing tesseract': 'Starting the text reader',
  'loading language traineddata': 'Downloading language data (first time only)',
  'initializing api': 'Getting ready',
  'recognizing text': 'Reading the bill',
};

export default function Scan() {
  const { settings, profile, saveExpense, openIrd } = useStore();
  const toast = useToast();
  const [step, setStep] = useState('pick'); // pick | reading | review
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState({});
  const [progress, setProgress] = useState({ status: '', progress: 0 });
  const [preview, setPreview] = useState('');
  const [rawText, setRawText] = useState('');
  const [viewPhoto, setViewPhoto] = useState(false);
  const [saving, setSaving] = useState(false);

  const engineLabel = settings.ocrEngine === OCR_ENGINES.VISION
    ? `${VISION_PROVIDERS[settings.visionProvider]?.label} (${settings.models[settings.visionProvider]})`
    : `Tesseract, on this device${settings.tesseractNepali ? ' (English + Nepali)' : ''}`;

  async function processImage(src) {
    setStep('reading');
    setPreview(src);
    setProgress({ status: 'Preparing the photo', progress: 0 });
    const base = blankExpense(profile.region);
    try {
      const [stored, ocrImage] = await Promise.all([compressImage(src), prepareForOcr(src)]);
      let fields = {};
      let engine = settings.ocrEngine;
      try {
        const out = await extractBill(ocrImage, settings, { region: profile.region, onProgress: setProgress });
        fields = out.fields;
        engine = out.engine;
        setRawText(out.rawText);
      } catch (err) {
        toast(`Could not read the bill automatically: ${err.message} Fill in the details below.`, 'error');
      }
      setDraft({ ...base, ...fields, receiptImage: stored.dataUrl, ocrEngine: engine });
      setErrors({});
      setStep('review');
    } catch (err) {
      toast(err.message || 'Could not open that image.', 'error');
      setStep('pick');
    }
  }

  async function onFile(file) {
    const err = validateImageFile(file);
    if (err) return toast(err, 'error');
    processImage(await fileToDataUrl(file));
  }

  async function save(thenApply) {
    const errs = validateExpense(draft);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast('Check the highlighted fields.', 'error');
      return;
    }
    setSaving(true);
    try {
      const saved = await saveExpense(draft);
      toast('Bill saved to your ledger.');
      reset();
      if (thenApply) openIrd(saved);
      else window.location.hash = '#/ledger';
    } catch (e) {
      toast(e.message || 'Could not save.', 'error');
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setStep('pick');
    setDraft(null);
    setPreview('');
    setRawText('');
    setErrors({});
  }

  if (step === 'reading') {
    const pct = Math.round((progress.progress || 0) * 100);
    return (
      <div>
        <PageHeader title="Reading your bill" subtitle={engineLabel} />
        <Card className="mx-auto max-w-md overflow-hidden">
          {preview && <img src={preview} alt="Bill being read" className="max-h-80 w-full bg-slate-100 object-contain" />}
          <div className="p-5">
            <div className="flex items-center gap-2 font-semibold"><LoaderCircle className="size-5 animate-spin text-brand" />{STATUS_TEXT[progress.status] || progress.status || 'Working'}…</div>
            <div className="mt-3 h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.max(5, pct)}%` }} /></div>
            <p className="mt-3 text-xs text-slate-500">The first scan downloads the text reader (a few MB). After that it works offline.</p>
          </div>
        </Card>
      </div>
    );
  }

  if (step === 'review' && draft) {
    const canApply = getIrdStatus(draft) === IRD_STATUS.NOT_APPLIED;
    return (
      <div>
        <PageHeader
          title="Check the details"
          subtitle="OCR makes mistakes. Fix anything that looks wrong, then save."
          actions={<Button variant="ghost" icon={RotateCcw} onClick={reset}>Start over</Button>}
        />
        <Card className="p-4 md:p-5">
          <BillForm
            value={draft}
            errors={errors}
            region={profile.region}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            onPhoto={async (file) => {
              try {
                const img = await photoFromFile(file);
                setDraft((d) => ({ ...d, receiptImage: img }));
              } catch (e) {
                toast(e.message, 'error');
              }
            }}
            onRemovePhoto={() => setDraft((d) => ({ ...d, receiptImage: null }))}
            onViewPhoto={() => setViewPhoto(true)}
          />
          {rawText && (
            <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <summary className="cursor-pointer font-semibold text-slate-700"><FileText className="mr-1 inline size-4" />Text the scanner read</summary>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap font-mono text-xs text-slate-700">{rawText}</pre>
            </details>
          )}
          <div className="sticky bottom-20 mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white pt-4 md:static">
            <Button variant="ghost" onClick={reset}>Discard</Button>
            {canApply && <Button variant="outline" icon={Ticket} disabled={saving} onClick={() => save(true)}>Save & apply to IRD</Button>}
            <Button variant="dark" icon={Save} disabled={saving} onClick={() => save(false)}>Save bill</Button>
          </div>
        </Card>
        {viewPhoto && <PhotoViewer expense={draft} onClose={() => setViewPhoto(false)} />}
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Scan a bill" subtitle={<>OCR engine: <b>{engineLabel}</b> · <a href="#/settings" className="font-semibold text-navy underline">change</a></>} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="card flex cursor-pointer flex-col items-center gap-3 border-2 border-dashed border-brand/40 bg-brand-soft px-6 py-10 text-center transition hover:border-brand">
          <span className="flex size-14 items-center justify-center rounded-full bg-brand text-white shadow"><Camera className="size-7" /></span>
          <span className="text-lg font-bold text-slate-900">Take a photo</span>
          <span className="text-sm text-slate-600">Uses your phone’s back camera. Lay the bill flat, in good light.</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        <label
          className="card flex cursor-pointer flex-col items-center gap-3 border-2 border-dashed border-slate-300 px-6 py-10 text-center transition hover:border-slate-500"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
        >
          <span className="flex size-14 items-center justify-center rounded-full bg-slate-900 text-white shadow"><Upload className="size-7" /></span>
          <span className="text-lg font-bold text-slate-900">Upload an image</span>
          <span className="text-sm text-slate-600">JPG, PNG or WEBP. Drop a file here or tap to choose.</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Button size="lg" icon={Sparkles} onClick={() => processImage(sampleReceiptForScan())}>Try with a sample receipt</Button>
        <Button size="lg" icon={PencilLine} onClick={() => { setDraft(blankExpense(profile.region)); setStep('review'); }}>Enter a bill by hand</Button>
      </div>
      <Card className="mt-5 p-4 text-sm text-slate-600">
        <h2 className="mb-2 flex items-center gap-2 font-bold text-slate-900"><ScanText className="size-4" />Tips for a clean read</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Fill the frame with the bill and keep the text straight.</li>
          <li>Handwritten or Nepali-script bills read best with a vision API key (Settings → OCR engine).</li>
          <li>Photos are shrunk to under 300 KB and stored only in this browser.</li>
        </ul>
      </Card>
    </div>
  );
}
