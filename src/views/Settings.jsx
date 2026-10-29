import { useState } from 'react';
import {
  Database, Download, Eye, EyeOff, HardDriveUpload, KeyRound, ScanText, Sparkles, Trash, UserRound,
} from 'lucide-react';
import { OCR_ENGINES, REGIONS, VISION_PROVIDERS } from '../lib/constants.js';
import { backupFilename, buildBackup, readBackupFile, validateBackup } from '../lib/backup.js';
import { bytes, downloadBlob } from '../lib/format.js';
import { validateProfile } from '../lib/profile.js';
import { useStore } from '../store.jsx';
import { useToast } from '../components/Toast.jsx';
import { Button, Card, Field, Modal, PageHeader, Segmented, Toggle } from '../components/ui.jsx';

function ProfileSection() {
  const { profile, setProfile } = useStore();
  const toast = useToast();
  const [p, setP] = useState(profile);
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setP({ ...p, [k]: e.target.value });

  function save() {
    const errs = validateProfile(p);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setProfile({ ...p, fullName: p.fullName.trim(), address: p.address.trim(), phone: p.phone.trim(), pan: (p.pan || '').trim() });
    toast('Profile saved.');
  }

  return (
    <Card className="p-4 md:p-5">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold"><UserRound className="size-5" />Your profile</h2>
      <p className="mb-4 text-sm text-slate-600">Used to fill the IRD form and the PDF header. Stored only in this browser.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="p-name" error={errors.fullName}>
          <input id="p-name" className={`input ${errors.fullName ? 'input-error' : ''}`} value={p.fullName} onChange={set('fullName')} autoComplete="name" maxLength={120} />
        </Field>
        <Field label="Mobile number" htmlFor="p-phone" error={errors.phone} hint="98XXXXXXXX or 97XXXXXXXX">
          <input id="p-phone" inputMode="tel" className={`input num ${errors.phone ? 'input-error' : ''}`} value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} autoComplete="tel" />
        </Field>
        <Field label="Address" htmlFor="p-addr" error={errors.address} className="sm:col-span-2">
          <input id="p-addr" className={`input ${errors.address ? 'input-error' : ''}`} value={p.address} onChange={set('address')} autoComplete="street-address" maxLength={250} placeholder="e.g. Baneshwor-10, Kathmandu" />
        </Field>
        <Field label="Personal PAN (optional)" htmlFor="p-pan" error={errors.pan} hint="Shown on PDF reports; handy for prize claims">
          <input id="p-pan" inputMode="numeric" className={`input num ${errors.pan ? 'input-error' : ''}`} value={p.pan || ''} onChange={(e) => setP({ ...p, pan: e.target.value.replace(/\D/g, '').slice(0, 9) })} />
        </Field>
        <Field label="Default region">
          <Segmented value={p.region} onChange={(region) => setP({ ...p, region })} options={[{ value: REGIONS.NEPAL, label: 'Nepal (NPR रु)' }, { value: REGIONS.INTL, label: 'International' }]} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end"><Button variant="dark" onClick={save}>Save profile</Button></div>
    </Card>
  );
}

function OcrSection() {
  const { settings, setSettings } = useStore();
  const toast = useToast();
  const [s, setS] = useState(settings);
  const [show, setShow] = useState(false);
  const prov = s.visionProvider;

  function save() {
    setSettings(s);
    toast('OCR settings saved.');
  }

  return (
    <Card className="p-4 md:p-5">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold"><ScanText className="size-5" />OCR engine</h2>
      <p className="mb-4 text-sm text-slate-600">How BillKhata reads your bill photos.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { v: OCR_ENGINES.TESSERACT, t: 'Tesseract (free, on device)', d: 'Runs in your browser. Works offline after the first download. Best on clear printed bills.' },
          { v: OCR_ENGINES.VISION, t: 'Vision API (high accuracy)', d: 'Uses your own Gemini, OpenAI or Claude key. Much better on handwritten and Nepali bills.' },
        ].map((o) => (
          <button key={o.v} type="button" onClick={() => setS({ ...s, ocrEngine: o.v })} aria-pressed={s.ocrEngine === o.v} className={`rounded-xl border-2 p-4 text-left transition ${s.ocrEngine === o.v ? 'border-navy bg-blue-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
            <span className="flex items-center gap-2 font-bold text-slate-900">{o.v === OCR_ENGINES.VISION ? <Sparkles className="size-4" /> : <ScanText className="size-4" />}{o.t}</span>
            <span className="mt-1 block text-sm text-slate-600">{o.d}</span>
          </button>
        ))}
      </div>

      {s.ocrEngine === OCR_ENGINES.TESSERACT ? (
        <div className="mt-4 rounded-lg border border-slate-200 p-3.5">
          <Toggle id="o-nep" checked={s.tesseractNepali} onChange={(v) => setS({ ...s, tesseractNepali: v })} label="Also read Nepali (Devanagari) script" description="Downloads extra language data on first use. Slower." />
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Provider" htmlFor="o-prov">
            <select id="o-prov" className="input" value={prov} onChange={(e) => setS({ ...s, visionProvider: e.target.value })}>
              {Object.entries(VISION_PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Model" htmlFor="o-model" hint={`Default: ${VISION_PROVIDERS[prov].defaultModel}`}>
            <input id="o-model" className="input font-mono text-sm" value={s.models[prov]} onChange={(e) => setS({ ...s, models: { ...s.models, [prov]: e.target.value.trim() } })} />
          </Field>
          <Field label={`${VISION_PROVIDERS[prov].label} API key`} htmlFor="o-key" className="sm:col-span-2" hint="Stored only in this browser’s localStorage and sent only to the provider. Never included in backups.">
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input id="o-key" type={show ? 'text' : 'password'} className="input pl-9 pr-10 font-mono text-sm" value={s.apiKeys[prov]} placeholder={VISION_PROVIDERS[prov].keyHint} onChange={(e) => setS({ ...s, apiKeys: { ...s.apiKeys, [prov]: e.target.value.trim() } })} autoComplete="off" spellCheck="false" />
              <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label={show ? 'Hide key' : 'Show key'}>
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
        </div>
      )}
      <div className="mt-5 flex justify-end"><Button variant="dark" onClick={save}>Save OCR settings</Button></div>
    </Card>
  );
}

function DataSection() {
  const { expenses, profile, replaceAll, mergeExpenses, setProfile, removeSamples, loadSamples } = useStore();
  const toast = useToast();
  const [pending, setPending] = useState(null); // validated backup awaiting a mode choice
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState('merge');
  const sizeEstimate = new Blob([JSON.stringify(expenses)]).size;
  const samples = expenses.filter((e) => e.isSample).length;

  function download() {
    const data = buildBackup(profile, expenses);
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), backupFilename());
    toast(`Backup downloaded (${expenses.length} bills).`);
  }

  async function pick(file) {
    try {
      const result = validateBackup(await readBackupFile(file));
      if (!result.ok) throw new Error(result.errors.join(' '));
      setPending({ ...result, fileName: file.name });
      setMode('merge');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function restore() {
    const { expenses: list, profile: p } = pending;
    if (mode === 'overwrite') {
      if (!window.confirm(`Replace all ${expenses.length} bills in this browser with the ${list.length} bills from the backup?`)) return;
      await replaceAll(list);
      if (p) setProfile(p);
      toast(`Restored ${list.length} bills.`);
    } else {
      const added = await mergeExpenses(list);
      toast(`Added ${added} new bill${added === 1 ? '' : 's'}; ${list.length - added} already here.`);
    }
    setPending(null);
  }

  async function wipe() {
    if (!window.confirm('Delete every bill in this browser? Download a backup first if you might want them back.')) return;
    await replaceAll([]);
    toast('All bills deleted.');
  }

  return (
    <Card className="p-4 md:p-5">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold"><Database className="size-5" />Backup & restore</h2>
      <p className="mb-4 text-sm text-slate-600">
        Your bills live only in this browser ({expenses.length} bills, about {bytes(sizeEstimate)} with photos). Clearing site data deletes them, so keep a backup file.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={download} className="flex items-center gap-3 rounded-xl border-2 border-slate-200 p-4 text-left hover:border-slate-400">
          <Download className="size-6 shrink-0 text-navy" />
          <span><span className="block font-bold">Download backup</span><span className="text-sm text-slate-600">{backupFilename()}</span></span>
        </button>
        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]); }}
          className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed p-4 ${dragging ? 'border-navy bg-blue-50' : 'border-slate-300 hover:border-slate-400'}`}
        >
          <HardDriveUpload className="size-6 shrink-0 text-navy" />
          <span><span className="block font-bold">Restore from backup</span><span className="text-sm text-slate-600">Drop a .json file here or tap to choose</span></span>
          <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </div>
      <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
        {samples > 0
          ? <Button icon={Trash} onClick={async () => toast(`Removed ${await removeSamples()} sample bills.`)}>Remove {samples} sample bills</Button>
          : <Button icon={Sparkles} onClick={async () => { await loadSamples(); toast('Sample bills added.'); }}>Load sample bills</Button>}
        <Button variant="danger" icon={Trash} onClick={wipe} disabled={!expenses.length}>Delete all bills</Button>
      </div>

      {pending && (
        <Modal
          open
          onClose={() => setPending(null)}
          title="Restore backup"
          size="md"
          footer={<><Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button><Button variant={mode === 'overwrite' ? 'primary' : 'dark'} onClick={restore}>{mode === 'overwrite' ? 'Overwrite and restore' : 'Merge bills'}</Button></>}
        >
          <p className="text-sm text-slate-700">
            <b>{pending.fileName}</b>{pending.exportedAt ? `, made ${new Date(pending.exportedAt).toLocaleString('en-GB')}` : ''}: {pending.expenses.length} valid bills
            {pending.profile ? ` and a profile for ${pending.profile.fullName || 'someone'}` : ''}.
          </p>
          {pending.skipped.length > 0 && (
            <details className="mt-2 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-950">
              <summary className="cursor-pointer font-semibold">{pending.skipped.length} item(s) will be skipped</summary>
              <ul className="mt-1 list-disc pl-5">{pending.skipped.map((s) => <li key={s}>{s}</li>)}</ul>
            </details>
          )}
          <div className="mt-4 space-y-2">
            {[
              ['merge', 'Merge', 'Add bills that are not already here (matched by id). Keeps your current bills and profile.'],
              ['overwrite', 'Overwrite', 'Replace everything in this browser with the backup, including the profile.'],
            ].map(([v, t, d]) => (
              <label key={v} className={`flex cursor-pointer gap-3 rounded-lg border-2 p-3 ${mode === v ? 'border-navy bg-blue-50/50' : 'border-slate-200'}`}>
                <input type="radio" name="mode" value={v} checked={mode === v} onChange={() => setMode(v)} className="mt-1 accent-navy" />
                <span><span className="block font-semibold">{t}</span><span className="text-sm text-slate-600">{d}</span></span>
              </label>
            ))}
          </div>
        </Modal>
      )}
    </Card>
  );
}

export default function Settings() {
  const { profile } = useStore();
  return (
    <div>
      <PageHeader title="Settings" subtitle="Profile, OCR and your data" />
      <div className="space-y-5">
        {/* Re-mount when a restore replaces the profile. */}
        <ProfileSection key={JSON.stringify(profile)} />
        <OcrSection />
        <DataSection />
        <p className="px-1 text-xs text-slate-500">
          BillKhata is an independent helper and is not affiliated with Nepal’s Inland Revenue Department. Always check your entry on prize.ird.gov.np.
        </p>
      </div>
    </div>
  );
}
