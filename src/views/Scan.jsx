// Capture -> OCR -> verify -> save.
import { useState } from 'react';
import { Camera, Divide, FileDown, FileText, LoaderCircle, PencilLine, RotateCcw, Save, ScanEye, ScanText, ShieldCheck, Sparkles, Ticket, Upload } from 'lucide-react';
import { IRD_STATUS, OCR_ENGINES, VISION_PROVIDERS } from '../lib/constants.js';
import { blankExpense, validateExpense } from '../lib/expense.js';
import { compressImage, fileToDataUrl, imageHash, prepareForOcr, validateImageFile } from '../lib/image.js';
import { findDuplicateBill, getIrdStatus } from '../lib/ird.js';
import { extractBill, extractBillFromText, itemsMatchTotal, LOW_CONFIDENCE, needsBetterRead, visionProviderWithKey } from '../lib/ocr/index.js';
import { applyMerchantMemory } from '../lib/merchants.js';
import { sampleReceiptForScan } from '../lib/sample.js';
import { useStore } from '../store.jsx';
import BillForm from '../components/BillForm.jsx';
import { duplicateHold, photoFieldsFromFile, PhotoViewer } from '../components/Modals.jsx';
import { useToast } from '../components/Toast.jsx';
import { Button, Card, PageHeader, useFileDrop } from '../components/ui.jsx';

const STATUS_TEXT = {
  'loading tesseract core': 'Loading the text reader',
  'initializing tesseract': 'Starting the text reader',
  'loading language traineddata': 'Downloading language data (first time only)',
  'initializing api': 'Getting ready',
  'recognizing text': 'Reading the bill',
};

export default function Scan() {
  const { settings, profile, saveExpense, openIrd, expenses } = useStore();
  const toast = useToast();
  const [step, setStep] = useState('pick'); // pick | reading | review
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState({});
  const [progress, setProgress] = useState({ status: '', progress: 0 });
  const [preview, setPreview] = useState('');
  const [rawText, setRawText] = useState('');
  const [viewPhoto, setViewPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ocrImages, setOcrImages] = useState(null); // kept so a re-scan needs no re-upload
  const [lastRead, setLastRead] = useState(null); // { engine, confidence, fields } of the latest OCR pass
  const [rescanning, setRescanning] = useState(false);
  const rescanProvider = visionProviderWithKey(settings);

  const engineLabel = settings.ocrEngine === OCR_ENGINES.VISION
    ? `${VISION_PROVIDERS[settings.visionProvider]?.label} (${settings.models[settings.visionProvider]})`
    : `Tesseract, on this device${settings.tesseractNepali ? ' (English + Nepali)' : ''}`;

  /** `text`: a PDF bill's own text, read instead of running OCR on the picture. */
  async function processImage(src, { text = '' } = {}) {
    setStep('reading');
    setPreview(src);
    setProgress({ status: 'Preparing the photo', progress: 0 });
    const base = blankExpense(profile.region);
    try {
      const [stored, images] = await Promise.all([compressImage(src), prepareForOcr(src)]);
      setOcrImages(images);
      let fields = {};
      let engine = settings.ocrEngine;
      try {
        const out = text
          ? extractBillFromText(text, { region: profile.region })
          : await extractBill(images, settings, { region: profile.region, onProgress: setProgress });
        fields = out.fields;
        engine = out.engine;
        setRawText(out.rawText);
        setLastRead({ engine: text ? 'pdf-text' : settings.ocrEngine, confidence: out.confidence, fields: out.fields, totalGuessed: out.totalGuessed });
      } catch (err) {
        setLastRead({ engine: settings.ocrEngine, confidence: 0, fields: {} });
        toast(`Could not read the bill automatically: ${err.message} Fill in the details below.`, 'error');
      }
      // Shops seen before: fill a missing name/PAN and reuse the category picked last time.
      fields = applyMerchantMemory(fields, expenses).fields;
      setDraft({ ...base, ...fields, receiptImage: stored.dataUrl, imageHash: await imageHash(stored.dataUrl), ocrEngine: engine });
      setErrors({});
      setStep('review');
    } catch (err) {
      toast(err.message || 'Could not open that image.', 'error');
      setStep('pick');
    }
  }

  async function rescanWithVision() {
    if (!ocrImages || !rescanProvider) return;
    setRescanning(true);
    try {
      const visionSettings = { ...settings, ocrEngine: OCR_ENGINES.VISION, visionProvider: rescanProvider };
      const out = await extractBill(ocrImages, visionSettings, { region: profile.region });
      const fields = applyMerchantMemory(out.fields, expenses).fields;
      setDraft((d) => ({ ...d, ...fields, ocrEngine: out.engine }));
      setRawText(out.rawText);
      setLastRead({ engine: OCR_ENGINES.VISION, confidence: null, fields: out.fields });
      toast(`Re-read with ${VISION_PROVIDERS[rescanProvider].label}. Check the fields.`);
    } catch (err) {
      toast(`Vision re-scan failed: ${err.message}`, 'error');
    } finally {
      setRescanning(false);
    }
  }

  async function onFile(file) {
    if (!file) return;
    const { isPdf, readBillPdf } = await import('../lib/pdfBill.js');
    if (isPdf(file)) {
      setStep('reading');
      setProgress({ status: 'Opening the PDF', progress: 0.05 });
      try {
        const { image, text, pages } = await readBillPdf(file);
        if (pages > 1) toast(`That PDF has ${pages} pages; page 1 was read.`);
        return processImage(image, { text });
      } catch (e) {
        toast(e.message, 'error');
        return setStep('pick');
      }
    }
    const err = validateImageFile(file);
    if (err) return toast(`${err.replace(/\.$/, '')}, or a PDF.`, 'error');
    processImage(await fileToDataUrl(file));
  }

  // Drop a photo or PDF anywhere on the page while choosing.
  const [dragging, dropProps] = useFileDrop((files) => step === 'pick' && onFile(files[0]));

  async function save(then) {
    const errs = validateExpense(draft);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast('Check the highlighted fields.', 'error');
      return;
    }
    if (duplicateHold(draft, expenses).length) {
      toast('This looks like a bill you already saved. Choose what to do in the box at the top: discard the scan, put it on the saved bill, or keep both.', 'error');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSaving(true);
    try {
      const saved = await saveExpense(draft);
      toast('Bill saved to your ledger, on this device.');
      reset();
      if (then === true || then === 'apply') openIrd(saved);
      else if (then === 'split') window.location.hash = `#/split-bill/${encodeURIComponent(saved.id)}`;
      else window.location.hash = '#/ledger';
    } catch (e) {
      toast(e.message || 'Could not save.', 'error');
    } finally {
      setSaving(false);
    }
  }

  /**
   * The bank row this scan belongs to already has a photo-less bill (added from the Bank page).
   * The scan's details go onto that bill, which keeps its code, split, trip and IRD state.
   */
  async function useScanFor(other) {
    const SCAN_FIELDS = ['merchantName', 'sellerPan', 'invoiceNumber', 'billDateAD', 'billDateBS', 'totalAmount', 'vatAmount', 'category', 'lineItems', 'receiptImage', 'imageHash', 'isNepalBill', 'isEstimate', 'ocrEngine'];
    const fromScan = Object.fromEntries(SCAN_FIELDS.filter((k) => draft[k] !== undefined && draft[k] !== '' && draft[k] !== null).map((k) => [k, draft[k]]));
    setSaving(true);
    try {
      const saved = await saveExpense({
        ...other,
        ...fromScan,
        source: 'scan',
        notes: [other.notes, draft.notes].filter(Boolean).join(' · '),
      });
      toast(`Scan added to bill ${saved.billCode || ''}: one bill, now with its photo.`);
      reset();
      window.location.hash = '#/ledger';
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
    setOcrImages(null);
    setLastRead(null);
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
    const canApply = getIrdStatus(draft) === IRD_STATUS.NOT_APPLIED && !findDuplicateBill(draft, expenses);
    return (
      <div>
        <PageHeader
          title={draft.ocrEngine ? 'Check the details' : 'New bill'}
          subtitle={draft.ocrEngine === 'pdf-text' ? 'Read from the PDF’s own text. Check it, then save.' : draft.ocrEngine ? 'OCR makes mistakes. Fix anything that looks wrong, then save.' : 'Fill in the details, then save. Shops you’ve saved before are suggested.'}
          actions={<Button variant="ghost" icon={RotateCcw} onClick={reset}>Start over</Button>}
        />
        {lastRead?.engine === OCR_ENGINES.TESSERACT && ocrImages && needsBetterRead(lastRead) && (
          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-center">
            <ScanEye className="size-6 shrink-0" />
            <div className="flex-1">
              <p className="font-bold">The on-device reader wasn’t sure about this bill.</p>
              <p className="mt-0.5">
                {[
                  !lastRead.fields.isEstimate && !/^\d{9}$/.test(String(lastRead.fields.sellerPan || '')) && 'no seller PAN found',
                  !(Number(lastRead.fields.totalAmount) > 0) && 'no total found',
                  lastRead.totalGuessed && Number(lastRead.fields.totalAmount) > 0 && 'total not found on the bill: the one shown is the sum of the items read, check it',
                  (lastRead.fields.lineItems || []).length > 0 && !itemsMatchTotal(lastRead.fields.lineItems, lastRead.fields.totalAmount) && 'items don’t add up to the total',
                  lastRead.confidence != null && lastRead.confidence < LOW_CONFIDENCE && `confidence ${Math.round(lastRead.confidence)}%`,
                ].filter(Boolean).join(' · ')}
                {rescanProvider ? '. A vision model reads faded and handwritten bills much better.' : '. Add a vision API key in Settings to re-read bills like this in one click.'}
              </p>
            </div>
            {rescanProvider
              ? <Button variant="dark" icon={rescanning ? LoaderCircle : ScanEye} className={rescanning ? '[&_svg]:animate-spin' : ''} disabled={rescanning} onClick={rescanWithVision}>{rescanning ? 'Re-scanning…' : 'Re-scan with Vision AI'}</Button>
              : <a href="#/settings" className="font-semibold text-navy underline">Open Settings</a>}
          </div>
        )}
        <Card className="p-4 md:p-5">
          <BillForm
            value={draft}
            errors={errors}
            region={profile.region}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            onPhoto={async (file) => {
              try {
                const fields = await photoFieldsFromFile(file);
                setDraft((d) => ({ ...d, ...fields }));
              } catch (e) {
                toast(e.message, 'error');
              }
            }}
            onRemovePhoto={() => setDraft((d) => ({ ...d, receiptImage: null, imageHash: '' }))}
            onViewPhoto={() => setViewPhoto(true)}
            onDiscard={() => { reset(); toast('Duplicate scan discarded.'); }}
            discardLabel="Discard Duplicate Scan"
            onUseFor={useScanFor}
          />
          {rawText && (
            <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <summary className="cursor-pointer font-semibold text-slate-700"><FileText className="mr-1 inline size-4" />Text the scanner read</summary>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap font-mono text-xs text-slate-700">{rawText}</pre>
            </details>
          )}
          {/* Phones: one row just above the bottom nav, in thumb reach; Save takes most of it. */}
          <div className="above-nav sticky z-10 -mx-4 mt-5 flex items-center gap-2 border-t border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur md:static md:mx-0 md:flex-wrap md:justify-end md:bg-white md:px-0 md:pb-0 md:pt-4">
            <span className="mr-auto hidden items-center gap-1.5 text-xs text-slate-500 md:inline-flex"><ShieldCheck className="size-3.5 text-emerald-700" />Saved only on this device</span>
            <span className="hidden md:contents"><Button variant="ghost" onClick={reset}>Discard</Button></span>
            <Button variant="outline" icon={Divide} disabled={saving} onClick={() => save('split')} aria-label="Save and split">
              <span className="md:hidden">Split</span><span className="hidden md:inline">Save &amp; split{draft.lineItems?.length ? ` (${draft.lineItems.length})` : ''}</span>
            </Button>
            {canApply && (
              <Button variant="outline" icon={Ticket} disabled={saving} onClick={() => save('apply')} aria-label="Save and apply to the IRD draw">
                <span className="md:hidden">IRD</span><span className="hidden md:inline">Save &amp; apply to IRD</span>
              </Button>
            )}
            <Button variant="dark" size="lg" icon={Save} disabled={saving} onClick={() => save(false)} className="order-first flex-1 md:order-last md:h-10 md:flex-none md:text-sm">Save bill</Button>
          </div>
        </Card>
        {viewPhoto && <PhotoViewer expense={draft} onClose={() => setViewPhoto(false)} />}
      </div>
    );
  }

  const byHand = () => { setDraft(blankExpense(profile.region)); setStep('review'); };
  const pickFile = (e) => { onFile(e.target.files?.[0]); e.target.value = ''; };
  return (
    <div {...dropProps} className="relative">
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-6">
          <div className="rounded-2xl border-2 border-dashed border-white bg-slate-900/80 px-8 py-10 text-center text-white">
            <FileDown className="mx-auto size-10" />
            <p className="mt-2 text-lg font-bold">Drop the bill here</p>
            <p className="text-sm text-slate-300">A photo (JPG, PNG, WEBP) or a PDF</p>
          </div>
        </div>
      )}
      <PageHeader title="Add a bill" subtitle={<>OCR engine: <b>{engineLabel}</b> · <a href="#/settings" className="font-semibold text-navy underline">change</a></>} />
      {/* Scan and type-it-in side by side: both are first-class ways to add a bill. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <label className="card flex cursor-pointer flex-col items-center gap-2 border-2 border-dashed border-brand/40 bg-brand-soft px-3 py-6 text-center transition hover:border-brand sm:gap-3 sm:px-6 sm:py-10">
          <span className="flex size-12 items-center justify-center rounded-full bg-brand text-white shadow sm:size-14"><Camera className="size-6 sm:size-7" /></span>
          <span className="text-base font-bold text-slate-900 sm:text-lg">Scan a bill</span>
          <span className="text-xs text-slate-600 sm:text-sm">Take a photo with the back camera. Lay the bill flat, in good light.</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={pickFile} />
        </label>
        <button type="button" onClick={byHand} className="card flex flex-col items-center gap-2 border-2 border-dashed border-slate-300 px-3 py-6 text-center transition hover:border-slate-500 sm:gap-3 sm:px-6 sm:py-10">
          <span className="flex size-12 items-center justify-center rounded-full bg-slate-900 text-white shadow sm:size-14"><PencilLine className="size-6 sm:size-7" /></span>
          <span className="text-base font-bold text-slate-900 sm:text-lg">Add by hand</span>
          <span className="text-xs text-slate-600 sm:text-sm">Type the shop, date and total. Your saved shops are suggested.</span>
        </button>
        <label className="card col-span-2 flex cursor-pointer items-center gap-3 border-2 border-dashed border-slate-300 px-4 py-4 text-left transition hover:border-slate-500 md:col-span-1 md:flex-col md:justify-center md:gap-3 md:px-6 md:py-10 md:text-center">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 md:size-14 md:bg-slate-900 md:text-white md:shadow"><Upload className="size-5 md:size-7" /></span>
          <span>
            <span className="block font-bold text-slate-900 md:text-lg">Upload a photo or PDF</span>
            <span className="block text-xs text-slate-600 md:mt-1 md:text-sm">JPG, PNG, WEBP or a PDF e-bill. Tap to choose, or drop a file anywhere on this page.</span>
          </span>
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" className="sr-only" onChange={pickFile} />
        </label>
      </div>
      <div className="mt-3">
        <Button size="lg" variant="ghost" icon={Sparkles} className="w-full sm:w-auto" onClick={() => processImage(sampleReceiptForScan())}>Try with a sample receipt</Button>
      </div>
      <Card className="mt-5 p-4 text-sm text-slate-600">
        <h2 className="mb-2 flex items-center gap-2 font-bold text-slate-900"><ScanText className="size-4" />Tips for a clean read</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Fill the frame with the bill and keep the text straight.</li>
          <li>Handwritten or Nepali-script bills read best with a vision API key (Settings → OCR engine).</li>
          <li>A PDF e-bill is read from its own text, so nothing is misread. Page 1 is kept as the bill’s photo.</li>
          <li>Photos are shrunk to under 300 KB and stored only in this browser.</li>
        </ul>
      </Card>
    </div>
  );
}
