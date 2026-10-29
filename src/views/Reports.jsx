import { useState } from 'react';
import { FileDown, LoaderCircle } from 'lucide-react';
import { filterExpenses, rangeFor, reportTotals } from '../lib/expense.js';
import { downloadBlob, money } from '../lib/format.js';
import { formatAD } from '../lib/nepaliDate.js';
import { buildReportPdf, reportFilename } from '../lib/pdf.js';
import { useStore } from '../store.jsx';
import { useToast } from '../components/Toast.jsx';
import { Button, Card, PageHeader, Segmented, Toggle } from '../components/ui.jsx';

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' },
];

export default function Reports() {
  const { expenses, profile } = useStore();
  const toast = useToast();
  const [range, setRange] = useState('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [images, setImages] = useState(false);
  const [busy, setBusy] = useState(false);

  const list = filterExpenses(expenses, { range, from, to });
  const r = rangeFor(range, { from, to });
  const t = reportTotals(list);
  const withPhotos = list.filter((e) => e.receiptImage).length;

  async function generate() {
    setBusy(true);
    try {
      const doc = await buildReportPdf({ expenses: list, profile, from: r.from, to: r.to, includeImages: images });
      downloadBlob(doc.output('blob'), reportFilename(r.from, r.to));
      toast('Report downloaded.');
    } catch (e) {
      toast(`Could not build the PDF: ${e.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  const stats = [
    ['Total expenses', money(t.total, profile.region)],
    ['Bills', t.count],
    ['VAT paid', money(t.vat, profile.region)],
    ['Cash (incl. CBMS)', money(t.cash, profile.region)],
    ['Digital QR / Card', money(t.digital, profile.region)],
    ['IRD coupons', t.coupons],
  ];

  return (
    <div>
      <PageHeader title="PDF expense report" subtitle="Made on this device. Nothing is uploaded." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-4 md:p-5">
          <h2 className="label">Date range</h2>
          <Segmented value={range} onChange={setRange} options={RANGES} />
          {range === 'custom' && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
              <span className="text-slate-500">to</span>
              <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
            </div>
          )}
          <p className="mt-2 text-sm text-slate-600">{r.from || r.to ? `${formatAD(r.from) || 'Start'} – ${formatAD(r.to) || 'today'}` : 'All dates'}</p>

          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {stats.map(([k, v]) => (
              <div key={k} className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{k}</dt>
                <dd className="num mt-1 text-lg font-extrabold text-slate-900">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 rounded-lg border border-slate-200 p-3.5">
            <Toggle id="pdf-images" checked={images} onChange={setImages} label="Include receipt images in an appendix" description={`${withPhotos} of ${list.length} bills have a photo. Useful as backup for audits or prize claims.`} />
          </div>

          <Button variant="primary" size="lg" icon={busy ? LoaderCircle : FileDown} className={`mt-5 w-full sm:w-auto ${busy ? '[&_svg]:animate-spin' : ''}`} onClick={generate} disabled={busy || !list.length}>
            {busy ? 'Building PDF…' : `Download PDF (${list.length} bill${list.length === 1 ? '' : 's'})`}
          </Button>
        </Card>

        <Card className="p-4 text-sm text-slate-600">
          <h2 className="mb-2 font-bold text-slate-900">What’s in the report</h2>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Header with your name, phone, personal PAN, the period and when it was made.</li>
            <li>Summary: total spend, VAT paid, cash vs digital, IRD coupon count.</li>
            <li>Every bill: AD/BS date, merchant, seller PAN, invoice, category, payment, coupon and amount.</li>
            <li>Optional appendix with the bill photos.</li>
          </ul>
          <p className="mt-3 text-xs text-slate-500">PDF fonts can’t draw Nepali script, so Devanagari names show as “[Nepali text]”. Amounts and numbers are unaffected.</p>
        </Card>
      </div>
    </div>
  );
}
