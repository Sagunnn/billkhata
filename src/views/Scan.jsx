// Capture -> OCR -> verify -> save.
import { useEffect, useState } from 'react';
import { Camera, Check, ChevronLeft, FileDown, FileText, LoaderCircle, PencilLine, ScanText, ShieldCheck, Sparkle, Sparkles, Ticket, Upload, Users } from 'lucide-react';
import { IRD_STATUS, OCR_ENGINES, VISION_PROVIDERS } from '../lib/constants.js';
import { blankExpense, validateExpense } from '../lib/expense.js';
import { BLURRY_FOCUS, compressImage, fileToDataUrl, imageHash, photoFocus, prepareForOcr, validateImageFile } from '../lib/image.js';
import { checkEligibility, findDuplicateBill, getIrdStatus } from '../lib/ird.js';
import { extractBill, extractBillFromText, itemsMatchTotal, LOW_CONFIDENCE, needsBetterRead, visionProviderWithKey } from '../lib/ocr/index.js';
import { applyMerchantMemory } from '../lib/merchants.js';
import { locateFields } from '../lib/ocr/locate.js';
import { money } from '../lib/format.js';
import { sampleReceiptForScan } from '../lib/sample.js';
import { useStore } from '../store.jsx';
import BillForm from '../components/BillForm.jsx';
import CameraScan from '../components/CameraScan.jsx';
import { duplicateHold, photoFieldsFromFile, PhotoViewer } from '../components/Modals.jsx';
import { useToast } from '../components/Toast.jsx';
import { ActionChip, Button, Card, Notice, PageHeader, Tooltip, useFileDrop } from '../components/ui.jsx';

// The fields a scan tries to read, for "9 of 10 fields found".
const READ_FIELDS = ['merchantName', 'sellerPan', 'invoiceNumber', 'billDateAD', 'totalAmount', 'vatAmount', 'category', 'lineItems'];

/** Why "Save & apply to IRD" can't be used yet ('' when it can). */
function irdBlocker(draft, expenses) {
  const s = getIrdStatus(draft);
  if (s === IRD_STATUS.NOT_APPLIED) return findDuplicateBill(draft, expenses) ? 'Already saved as another bill' : '';
  if (s === IRD_STATUS.AUTO) return 'QR and card bills are entered by your bank';
  if (s === IRD_STATUS.APPLIED) return 'Coupon already saved';
  const r = checkEligibility(draft).reasons.join(' ');
  if (/PAN/.test(r)) return 'Complete the 9-digit PAN to apply';
  if (/estimate/i.test(r)) return 'Estimates can’t enter the draw';
  if (/at least/.test(r)) return 'Bills under रु 100 can’t enter';
  if (/excluded/.test(r)) return 'This category isn’t in the draw';
  return 'Not eligible for the draw';
}

const STATUS_TEXT = {
  'Reading the text': 'Reading the bill',
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
  const hasCamera = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  // Phones open straight into the live camera; desktops start on the choices (drop, upload, type).
  const phoneCamera = () => hasCamera && Boolean(window.matchMedia?.('(pointer: coarse)').matches) && window.innerWidth < 768;
  const [camera, setCamera] = useState(phoneCamera);

  const engineLabel = settings.ocrEngine === OCR_ENGINES.VISION
    ? `${VISION_PROVIDERS[settings.visionProvider]?.label} (${settings.models[settings.visionProvider]})`
    : `PaddleOCR, on this device${settings.nepaliScript ? ' (Nepali model)' : ''}`;

  /** `text`: a PDF bill's own text, read instead of running OCR on the picture. */
  /** `checkFocus`: a photo that didn't come through the in-app camera's own blur check. */
  async function processImage(src, { text = '', checkFocus = false } = {}) {
    setStep('reading');
    setPreview(src);
    setProgress({ status: 'Preparing the photo', progress: 0 });
    const base = blankExpense(profile.region);
    const t0 = performance.now();
    try {
      const [stored, images, focus] = await Promise.all([compressImage(src), prepareForOcr(src), checkFocus ? photoFocus(src).catch(() => Infinity) : Infinity]);
      const blurry = focus < BLURRY_FOCUS;
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
        // Where each field sits on the photo, so the form can zoom to it.
        const boxes = out.words?.length ? locateFields(out.words, out.fields, images) : {};
        setLastRead({ engine: text ? 'pdf-text' : settings.ocrEngine, confidence: out.confidence, fields: out.fields, totalGuessed: out.totalGuessed, ms: performance.now() - t0, boxes, blurry });
      } catch (err) {
        setLastRead({ engine: settings.ocrEngine, confidence: 0, fields: {}, blurry });
        toast(`Could not read the bill automatically: ${err.message} Fill in the details below.`, 'error');
      }
      // Shops seen before: fill a missing name/PAN and reuse the category picked last time.
      fields = applyMerchantMemory(fields, expenses).fields;
      const { mathVerified, vatCheck, ...billFields } = fields; // read-time checks, not saved
      setDraft({ ...base, ...billFields, receiptImage: stored.dataUrl, imageHash: await imageHash(stored.dataUrl), ocrEngine: engine });
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
      const { mathVerified, vatCheck, ...fields } = applyMerchantMemory(out.fields, expenses).fields;
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
    processImage(await fileToDataUrl(file), { checkFocus: true });
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

  // Opening the scanner starts the one-time model download in the background, so the first scan
  // doesn't wait for it. Skipped on a data-saver connection.
  useEffect(() => {
    if (settings.ocrEngine !== OCR_ENGINES.LOCAL || navigator.connection?.saveData) return;
    import('../lib/ocr/local.js').then(({ warmUp }) => warmUp({ nepali: settings.nepaliScript }));
  }, [settings.ocrEngine, settings.nepaliScript]);

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
            <p className="mt-3 text-xs text-slate-500">The first scan downloads the text reader (about 6 MB, plus a few MB for the engine that runs it). It’s kept on this device, so later scans start right away, and your bill is never uploaded.</p>
          </div>
        </Card>
      </div>
    );
  }

  if (step === 'review' && draft) {
    const irdWhy = irdBlocker(draft, expenses);
    const read = lastRead?.fields || null;
    const vat = read?.vatCheck && Math.abs(Number(draft.totalAmount) - read.vatCheck.total) <= 1.5 ? read.vatCheck : null;
    const found = read ? READ_FIELDS.filter((k) => read[k] !== undefined && read[k] !== null && read[k] !== '').length : 0;
    const unsure = lastRead?.engine === OCR_ENGINES.LOCAL && ocrImages && needsBetterRead(lastRead);
    const problems = unsure ? [
      !lastRead.fields.isEstimate && !/^\d{9}$/.test(String(lastRead.fields.sellerPan || '')) && (String(lastRead.fields.sellerPan || '').length ? `The PAN has ${String(lastRead.fields.sellerPan).length} of 9 digits. Type the rest from the paper bill.` : 'No seller PAN found. Type it from the paper bill.'),
      !(Number(lastRead.fields.totalAmount) > 0) && 'No total found.',
      lastRead.totalGuessed && Number(lastRead.fields.totalAmount) > 0 && 'The total wasn’t printed clearly: the one shown is the sum of the items read.',
      (lastRead.fields.lineItems || []).length > 0 && !itemsMatchTotal(lastRead.fields.lineItems, lastRead.fields.totalAmount) && 'The items don’t add up to the total.',
      lastRead.confidence != null && lastRead.confidence < LOW_CONFIDENCE && `The reader was only ${Math.round(lastRead.confidence)}% sure.`,
    ].filter(Boolean) : [];
    return (
      <div>
        <div className="mb-4 flex items-center gap-2">
          <button type="button" onClick={() => { reset(); setCamera(phoneCamera()); }} aria-label="Retake" className="tap -ml-2 flex size-10 items-center justify-center rounded-full text-ink hover:bg-sunken"><ChevronLeft className="size-6" /></button>
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] font-semibold leading-6 text-ink md:t-h-l">{draft.ocrEngine ? 'Check the details' : 'New bill'}</h1>
            <p className="t-caption text-ink-3">
              {draft.ocrEngine === 'pdf-text' ? 'Read from the PDF’s own text' : lastRead?.ms ? `Read in ${(lastRead.ms / 1000).toFixed(1)} s ${lastRead.engine === OCR_ENGINES.VISION ? `by ${VISION_PROVIDERS[settings.visionProvider]?.label}` : 'on this device'} · ${found} of ${READ_FIELDS.length} fields found` : draft.ocrEngine ? 'Check each field against the bill' : 'Shops you’ve saved before are suggested'}
            </p>
          </div>
        </div>
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          {lastRead?.blurry && (
            <Notice tone="warning" title="The photo looks blurry"
              action={<ActionChip icon={Camera} onClick={() => { reset(); setCamera(phoneCamera()); }}>Take it again</ActionChip>}>
              Digits may be misread. Check each one against the paper bill, or take a sharper photo.
            </Notice>
          )}
          {vat && (
            <Notice tone="success" title="Total checked">
              <span className="num">{money(vat.subtotal)} + 13% VAT {money(vat.vat)} = {money(vat.total)}</span>
            </Notice>
          )}
          {problems.length > 0 && (
            <Notice tone="warning" title={`Check ${problems.length} field${problems.length === 1 ? '' : 's'}`}
              action={rescanProvider
                ? <ActionChip icon={rescanning ? LoaderCircle : Sparkle} disabled={rescanning} onClick={rescanWithVision}>{rescanning ? 'Re-scanning…' : 'Re-scan with Vision AI'}</ActionChip>
                : <a href="#/settings" className="text-[14px] font-medium text-brand underline">Add a vision key for faded bills</a>}>
              {problems.join(' ')}
            </Notice>
          )}
        </div>
        <BillForm
          value={draft}
          read={read}
          boxes={lastRead?.boxes}
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
          <details className="mt-5 rounded-[14px] border border-line bg-surface p-3 text-[14px]">
            <summary className="cursor-pointer font-medium text-ink-2"><FileText className="mr-1 inline size-4" />Text the scanner read</summary>
            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap font-mono text-[12px] text-ink-2">{rawText}</pre>
          </details>
        )}
        {/* Pinned save bar: Split, IRD (greyed with the reason while it can't apply), Save bill. */}
        <div className="hide-typing above-nav sticky z-20 -mx-4 mt-5 flex items-center gap-2 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:justify-end md:rounded-[16px] md:border md:px-3">
          <span className="mr-auto hidden items-center gap-1.5 text-[12px] text-ink-3 md:inline-flex"><ShieldCheck className="size-3.5 text-leaf" />Saved only on this device</span>
          <span className="hidden md:contents"><Button variant="ghost" onClick={reset}>Discard</Button></span>
          <Button size="lg" icon={Users} disabled={saving} onClick={() => save('split')} aria-label="Save and split">Split</Button>
          {draft.isNepalBill && (
            <Tooltip text={irdWhy}>
              <Button size="lg" icon={Ticket} disabled={saving} aria-disabled={irdWhy ? true : undefined}
                className={irdWhy ? '!border-transparent !bg-sunken !text-ink-3' : ''}
                onClick={() => (irdWhy ? toast(irdWhy, 'error') : save('apply'))} aria-label={irdWhy ? `Save and apply to IRD: ${irdWhy}` : 'Save and apply to the IRD draw'}>
                IRD<span className="hidden lg:inline">&nbsp;draw</span>
              </Button>
            </Tooltip>
          )}
          <Button variant="primary" size="lg" icon={Check} disabled={saving} onClick={() => save(false)} className="flex-1 md:flex-none">Save bill</Button>
        </div>
        {viewPhoto && <PhotoViewer expense={draft} onClose={() => setViewPhoto(false)} />}
      </div>
    );
  }

  const byHand = () => { setDraft(blankExpense(profile.region)); setStep('review'); };
  const pickFile = (e) => { onFile(e.target.files?.[0]); e.target.value = ''; };
  if (camera) {
    const off = (then) => () => { setCamera(false); then?.(); };
    return (
      <CameraScan
        onPhoto={(url) => { setCamera(false); processImage(url); }}
        onFile={(f) => { setCamera(false); onFile(f); }}
        onPdfOrFile={off()}
        onTypeIt={off(byHand)}
        onSample={off(() => processImage(sampleReceiptForScan()))}
        onClose={off(() => { if (window.history.length > 1) window.history.back(); else window.location.hash = '#/'; })}
      />
    );
  }
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
        {hasCamera ? (
          <button type="button" onClick={() => setCamera(true)} className="card flex flex-col items-center gap-2 border-2 border-dashed border-brand/40 bg-brand-soft px-3 py-6 text-center transition hover:border-brand sm:gap-3 sm:px-6 sm:py-10">
            <span className="flex size-12 items-center justify-center rounded-full bg-brand text-on-brand shadow sm:size-14"><Camera className="size-6 sm:size-7" /></span>
            <span className="text-base font-bold text-ink sm:text-lg">Scan a bill</span>
            <span className="text-xs text-ink-2 sm:text-sm">Point the camera at the bill. It’s taken and cropped by itself.</span>
          </button>
        ) : (
          <label className="card flex cursor-pointer flex-col items-center gap-2 border-2 border-dashed border-brand/40 bg-brand-soft px-3 py-6 text-center transition hover:border-brand sm:gap-3 sm:px-6 sm:py-10">
            <span className="flex size-12 items-center justify-center rounded-full bg-brand text-on-brand shadow sm:size-14"><Camera className="size-6 sm:size-7" /></span>
            <span className="text-base font-bold text-ink sm:text-lg">Scan a bill</span>
            <span className="text-xs text-ink-2 sm:text-sm">Take a photo with the back camera. Lay the bill flat, in good light.</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={pickFile} />
          </label>
        )}
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
