// "Someone else paid part of it too": when two or more people paid one bill (equally, or 70 and
// 50). The main payer keeps the bill and pays the rest; the others are listed with what they paid.
import { Plus, Users, X } from 'lucide-react';
import { equalPayers } from '../lib/payers.js';
import { money } from '../lib/format.js';

const toNum = (v) => Number(String(v ?? '').replace(/[^\d.]/g, '')) || 0;

/**
 * @param members [{ id, name }] everyone who could have paid
 * @param primaryId who keeps the bill (pays the rest); primaryName how to call them ("You", "Ram")
 * @param alsoPaid [{ memberId, amount }] the others (amounts may be strings while typing)
 */
export default function PaidByEditor({ members, primaryId, primaryName, total, alsoPaid = [], onChange, region }) {
  const nameOf = (id) => members.find((m) => m.id === id)?.name || 'Person';
  const free = (except) => members.filter((m) => m.id !== primaryId && !alsoPaid.some((p) => p.memberId === m.id && p.memberId !== except));
  const others = alsoPaid.reduce((s, p) => s + toNum(p.amount), 0);
  const rest = Math.round((Number(total) - others) * 100) / 100;
  const set = (i, patch) => onChange(alsoPaid.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const add = () => { const m = free()[0]; if (m) onChange([...alsoPaid, { memberId: m.id, amount: '' }]); };
  const equally = () => {
    const ids = [primaryId, ...alsoPaid.map((p) => p.memberId)];
    const split = equalPayers(ids, Number(total) || 0);
    onChange(alsoPaid.map((p) => ({ ...p, amount: String(split.find((x) => x.memberId === p.memberId).amount) })));
  };
  if (!alsoPaid.length) {
    return (
      <button type="button" onClick={add} disabled={!free().length} className="t-label inline-flex items-center gap-1.5 font-medium text-brand hover:underline disabled:opacity-40">
        <Users className="size-4" />Someone else paid part of it too
      </button>
    );
  }
  const tooMuch = Number(total) > 0 && rest <= 0;
  return (
    <div className="rounded-[14px] border border-line p-3">
      <p className="label">Who paid</p>
      <ul className="space-y-2">
        <li className="t-label flex items-center justify-between gap-2 text-ink">
          <span className="min-w-0 truncate"><b>{primaryName}</b> <span className="text-ink-3">· has the bill, pays the rest</span></span>
          <span className={`num shrink-0 font-semibold ${tooMuch ? 'text-danger' : ''}`}>{Number(total) > 0 ? money(Math.max(0, rest), region) : '—'}</span>
        </li>
        {alsoPaid.map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            <select className="input min-w-0 flex-1 py-1.5" value={p.memberId} onChange={(e) => set(i, { memberId: e.target.value })} aria-label="Who also paid">
              {free(p.memberId).map((m) => <option key={m.id} value={m.id}>{m.name || 'Person'}</option>)}
            </select>
            <label className="flex w-[112px] shrink-0 items-center gap-1 rounded-[10px] border border-line-strong bg-raised px-2 focus-within:border-navy">
              <span className="font-nepali text-[14px] text-ink-3">रु</span>
              <input inputMode="decimal" className="num min-w-0 flex-1 bg-transparent py-1.5 text-right text-[15px] text-ink focus:outline-none" value={p.amount}
                onChange={(e) => set(i, { amount: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" aria-label={`What ${nameOf(p.memberId)} paid`} />
            </label>
            <button type="button" onClick={() => onChange(alsoPaid.filter((_, j) => j !== i))} className="tap flex size-8 shrink-0 items-center justify-center rounded-full text-ink-3 hover:text-danger" aria-label={`${nameOf(p.memberId)} didn’t pay`}><X className="size-4" /></button>
          </li>
        ))}
      </ul>
      {tooMuch && <p className="t-caption mt-2 text-danger" role="alert">That’s {money(others, region)}, the whole bill or more. {primaryName} has the bill, so they paid at least part of it: lower these.</p>}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {free().length > 0 && <button type="button" onClick={add} className="t-label inline-flex items-center gap-1 font-medium text-brand hover:underline"><Plus className="size-4" />Another person</button>}
        <button type="button" onClick={equally} disabled={!(Number(total) > 0)} className="t-label font-medium text-brand hover:underline disabled:opacity-40">Paid equally</button>
      </div>
    </div>
  );
}
