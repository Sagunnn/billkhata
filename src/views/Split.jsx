// Split Khata: hub (#/split), editor (#/split-bill/<billId>) and read-only shared view (#/split/<token>).
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Beer, CircleCheck, ClipboardPaste, Divide, Drumstick, HandCoins, ImageDown, Leaf, LoaderCircle, Minus, Plus,
  Luggage, QrCode, ReceiptText, ScanText, Share2, ShieldAlert, Split as SplitIcon, Trash, UsersRound,
} from 'lucide-react';
import { CATEGORIES } from '../lib/constants.js';
import { money, downloadBlob } from '../lib/format.js';
import { formatAD, formatBS } from '../lib/nepaliDate.js';
import { deleteGroup, forgetFriend, loadFriends, loadGroups, rememberFriends, saveGroup } from '../lib/profile.js';
import {
  autoWeight, clearItemOverrides, clearMemberOverrides, computeSplit, makeItem, makeMember,
  newSplitForExpense, outstanding, parseLineItemsFromText, TAG_LABELS, TAGS, weightOf,
} from '../lib/splitter.js';
import { drawSplitSummary } from '../lib/splitImage.js';
import { useStore } from '../store.jsx';
import { QrBox, usePaymentQr } from '../components/PaymentQr.jsx';
import { useToast } from '../components/Toast.jsx';
import { Button, Card, CopyButton, EmptyState, PageHeader, Segmented } from '../components/ui.jsx';

const TAG_STYLE = {
  veg: ['bg-emerald-50 text-emerald-800 ring-emerald-200', Leaf],
  'non-veg': ['bg-red-50 text-red-800 ring-red-200', Drumstick],
  alcohol: ['bg-amber-50 text-amber-900 ring-amber-200', Beer],
  shared: ['bg-slate-100 text-slate-700 ring-slate-300', UsersRound],
};

function TagChip({ tag }) {
  const [cls, Icon] = TAG_STYLE[tag] || TAG_STYLE.veg;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${cls}`}><Icon className="size-3" />{TAG_LABELS[tag]}</span>;
}

/* ---------------- hub ---------------- */

export function SplitHub() {
  const { expenses, profile } = useStore();
  const qr = usePaymentQr();
  const splits = expenses.filter((e) => e.split).sort((a, b) => (b.split.updatedAt || '').localeCompare(a.split.updatedAt || ''));
  const food = CATEGORIES[0];
  const candidates = expenses
    .filter((e) => !e.split && Number(e.totalAmount) > 0)
    .sort((a, b) => (b.category === food) - (a.category === food) || (b.billDateAD || '').localeCompare(a.billDateAD || ''))
    .slice(0, 8);

  return (
    <div className="space-y-5">
      <PageHeader title="Split Khata" subtitle="Split a bill between friends. Veg, non-veg and drinks are ticked for each person automatically." actions={<a href="#/scan" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark"><ScanText className="size-4" />Scan a new bill</a>} />
      <a href="#/trips" className="flex items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white hover:bg-slate-800">
        <Luggage className="size-5 shrink-0 text-amber-300" />
        <span className="flex-1"><b>Trip Khata</b>: many bills, many payers. Log a whole trip and settle up in as few payments as possible.</span>
        <span className="font-semibold underline">Open</span>
      </a>
      {!qr && (
        <a href="#/settings" className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 hover:bg-amber-100">
          <QrCode className="size-5 shrink-0" /><span className="flex-1">Set up your <b>payment QR</b> in Settings so friends can scan and pay you back.</span>
        </a>
      )}
      <Card>
        <h2 className="border-b border-slate-200 px-4 py-3 font-bold">Your splits</h2>
        {splits.length ? (
          <ul className="divide-y divide-slate-100">
            {splits.map((e) => {
              const paid = Object.values(e.split.paid || {}).filter(Boolean).length;
              const others = (e.split.members || []).filter((m) => !m.isPayer && !m.out).length;
              return (
                <li key={e.id}>
                  <a href={`#/split-bill/${encodeURIComponent(e.id)}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{e.merchantName}</div>
                      <div className="text-xs text-slate-500">{formatAD(e.billDateAD)} · {(e.split.members || []).length} people · bill {money(e.totalAmount, profile.region)}</div>
                    </div>
                    <div className="text-right text-sm">
                      <div>My share <b className="num">{money(e.split.myShare, profile.region)}</b></div>
                      <div className={e.split.outstanding > 0 ? 'text-amber-800' : 'text-emerald-700'}>{e.split.outstanding > 0 ? `To collect ${money(e.split.outstanding, profile.region)}` : 'All settled'} · {paid}/{others} paid</div>
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        ) : <EmptyState icon={SplitIcon} title="No splits yet">Pick a bill below, or scan a restaurant bill and press “Save & split”.</EmptyState>}
      </Card>
      <Card>
        <h2 className="border-b border-slate-200 px-4 py-3 font-bold">Split a saved bill</h2>
        {candidates.length ? (
          <ul className="divide-y divide-slate-100">
            {candidates.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{e.merchantName}</div>
                  <div className="text-xs text-slate-500">{formatAD(e.billDateAD)} · {e.category}{e.lineItems?.length ? ` · ${e.lineItems.length} items read` : ''}</div>
                </div>
                <span className="num font-semibold">{money(e.totalAmount, profile.region)}</span>
                <a href={`#/split-bill/${encodeURIComponent(e.id)}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50"><Divide className="size-4" />Split</a>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={ReceiptText} title="No bills to split">Scan a bill first.</EmptyState>}
      </Card>
    </div>
  );
}

/* ---------------- editor ---------------- */

function Matrix({ split, update }) {
  const setWeight = (item, member, w) => {
    const row = { ...(split.overrides?.[item.id] || {}) };
    if (w === autoWeight(item.tag, member)) delete row[member.id];
    else row[member.id] = Math.max(0, w);
    const overrides = { ...split.overrides, [item.id]: row };
    if (!Object.keys(row).length) delete overrides[item.id];
    update({ ...split, overrides });
  };
  const toggleUnits = (item) => update({ ...split, items: split.items.map((it) => (it.id === item.id ? { ...it, units: !it.units } : it)) });

  const people = split.members.filter((m) => !m.out);
  if (split.mode === 'equal' || !split.items.length || people.length < 2) return null;
  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">Ticked automatically from each person’s diet and drinks. Tap a name to change it; use “By units” when someone had 2 of something.</p>
      <ul className="space-y-3">
        {split.items.map((it) => {
          const weights = people.map((m) => weightOf(split, it, m));
          const sumW = weights.reduce((s, w) => s + w, 0);
          return (
            <li key={it.id} className={`rounded-lg border p-3 ${sumW ? 'border-slate-200' : 'border-amber-300 bg-amber-50/50'}`}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-semibold">{it.name || 'Item'}</span>
                <TagChip tag={it.tag} />
                <span className="num ml-auto text-sm font-semibold">{money(it.amount)}</span>
                <button type="button" onClick={() => toggleUnits(it)} className={`rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${it.units ? 'bg-navy text-white ring-navy' : 'text-slate-600 ring-slate-300'}`} aria-pressed={Boolean(it.units)}>
                  {it.units ? 'By units (1x, 2x)' : 'Evenly'}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {people.map((m, i) => {
                  const w = weights[i];
                  const overridden = split.overrides?.[it.id]?.[m.id] != null;
                  if (it.units) {
                    return (
                      <span key={m.id} className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-3 pr-1 text-sm ring-1 ring-inset ${w ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-500 ring-slate-300'}`}>
                        {m.name || 'Person'}
                        <button type="button" className="rounded-full p-1 hover:bg-white/20" aria-label={`One less for ${m.name}`} onClick={() => setWeight(it, m, w - 1)}><Minus className="size-3" /></button>
                        <b className="num w-4 text-center">{w}</b>
                        <button type="button" className="rounded-full p-1 hover:bg-white/20" aria-label={`One more for ${m.name}`} onClick={() => setWeight(it, m, w + 1)}><Plus className="size-3" /></button>
                      </span>
                    );
                  }
                  return (
                    <button key={m.id} type="button" aria-pressed={w > 0} onClick={() => setWeight(it, m, w > 0 ? 0 : 1)} className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset transition ${w ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-500 ring-slate-300'} ${overridden ? 'underline decoration-dotted underline-offset-4' : ''}`}>
                      {w ? '✓ ' : ''}{m.name || 'Person'}
                    </button>
                  );
                })}
              </div>
              {!sumW && <p className="mt-2 text-xs font-semibold text-amber-900">Nobody is ticked for this item.</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Your own payment QR, exactly as uploaded, with this person's amount shown large and copyable.
 * Banking apps and eSewa ignore an amount added to a personal QR, so the QR isn't altered.
 */
function MemberPayQr({ payer, amount, name, region }) {
  const fixed = Number(amount).toFixed(2);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-4 rounded-lg bg-slate-50 p-3">
      <QrBox text={payer.image ? '' : payer.text} image={payer.image} label={payer.label} size={176} />
      <div className="min-w-[160px] flex-1 space-y-2 text-sm text-slate-700">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{name || 'They'} pay{name ? 's' : ''}</div>
        <div className="num text-3xl font-extrabold text-slate-900">{money(amount, region)}</div>
        <CopyButton value={fixed} label={`Copy ${fixed}`} />
        <p className="text-xs text-slate-500">Scan, then type this amount in the app.</p>
      </div>
    </div>
  );
}

/* ---------------- editor: 3 steps (Bill → People → Shares) ---------------- */

const STEPS = ['Bill', 'People', 'Shares'];

function Stepper({ step, setStep }) {
  return (
    <ol className="flex gap-1.5" aria-label="Steps">
      {STEPS.map((label, i) => (
        <li key={label} className="flex-1">
          <button
            type="button"
            onClick={() => setStep(i)}
            aria-current={step === i ? 'step' : undefined}
            className={`flex w-full flex-col items-start gap-1 rounded-lg px-1 pb-1 text-left text-xs font-bold ${step === i ? 'text-slate-900' : 'text-slate-400'}`}
          >
            <span className={`h-1.5 w-full rounded-full ${i <= step ? 'bg-brand' : 'bg-slate-200'}`} />
            {i + 1}. {label}
          </button>
        </li>
      ))}
    </ol>
  );
}

/** One item: a tidy line until tapped, then name / qty / amount / type fields. */
function ItemLine({ item, editing, onEdit, onChange, onRemove }) {
  if (!editing) {
    return (
      <li>
        <button type="button" onClick={onEdit} className="flex w-full items-center gap-2 py-2.5 text-left">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-slate-900">{item.name || 'Unnamed item'}{item.qty > 1 ? <span className="text-slate-500"> ×{item.qty}</span> : null}</span>
          </span>
          <TagChip tag={item.tag} />
          <span className="num w-20 text-right font-semibold">{money(item.amount)}</span>
        </button>
      </li>
    );
  }
  return (
    <li className="my-1 space-y-2 rounded-lg bg-slate-50 p-2.5 ring-1 ring-slate-200">
      <input className="input py-2" value={item.name} autoFocus onChange={(e) => onChange({ name: e.target.value })} placeholder="Item name" aria-label="Item name" />
      <div className="grid grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <input className="input num py-2" inputMode="numeric" value={item.qty} onChange={(e) => { const q = Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1); onChange({ qty: q, price: Math.round(((Number(item.amount) || 0) / q) * 100) / 100 }); }} aria-label="Quantity" />
        <input className="input num py-2" inputMode="decimal" value={item.amount} onChange={(e) => { const a = e.target.value.replace(/[^\d.]/g, ''); onChange({ amount: a, price: Math.round(((Number(a) || 0) / item.qty) * 100) / 100 }); }} aria-label="Amount" placeholder="Amount" />
        <select className="input py-2" value={item.tag} onChange={(e) => onChange({ tag: e.target.value })} aria-label="Type">
          {TAGS.map((t) => <option key={t} value={t}>{TAG_LABELS[t]}</option>)}
        </select>
      </div>
      <div className="flex justify-between">
        <button type="button" onClick={onRemove} className="inline-flex items-center gap-1 text-sm font-semibold text-brand"><Trash className="size-4" />Delete</button>
        <button type="button" onClick={onEdit} className="text-sm font-bold text-navy">Done</button>
      </div>
    </li>
  );
}

function BillStep({ expense, split, update, result, region, readPhoto, reading, goEqual }) {
  const { openPhoto, openEditor } = useStore();
  const [editing, setEditing] = useState('');
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState('');
  const setItem = (id, patch) => {
    let next = { ...split, items: split.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) };
    if (patch.tag) next = clearItemOverrides(next, id);
    update(next);
  };
  const addItem = () => {
    const it = makeItem({ name: '', amount: 0 });
    update({ ...split, items: [...split.items, it] });
    setEditing(it.id);
  };

  return (
    <div className="space-y-4">
      <Card className="flex items-center gap-3 p-3">
        {expense.receiptImage
          ? <button type="button" onClick={() => openPhoto(expense)} className="shrink-0 overflow-hidden rounded-md border border-slate-200" aria-label="View bill photo"><img src={expense.receiptImage} alt="" className="h-16 w-12 object-cover object-top" /></button>
          : <div className="flex h-16 w-12 shrink-0 items-center justify-center rounded-md bg-slate-100"><ReceiptText className="size-5 text-slate-400" /></div>}
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold">{expense.merchantName || 'Bill'}</div>
          <div className="text-xs text-slate-500">{expense.billCode ? `${expense.billCode} · ` : ''}{formatAD(expense.billDateAD)}{expense.billDateBS ? ` · ${formatBS(expense.billDateBS)}` : ''}</div>
          <button type="button" onClick={() => openEditor(expense)} className="text-xs font-semibold text-navy underline">Edit bill details</button>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Bill total</div>
          <div className="num text-xl font-extrabold">{money(result.total, region)}</div>
        </div>
      </Card>

      {!split.items.length && expense.lineItems?.length > 0 && (
        <button type="button" onClick={() => update({ ...split, mode: 'items', items: expense.lineItems.map((it) => makeItem(it)) })} className="w-full rounded-xl border-2 border-dashed border-navy/40 bg-blue-50/50 p-3 text-sm font-semibold text-navy">
          Use the {expense.lineItems.length} items read from this bill
        </button>
      )}

      <Card className="px-4 pb-3 pt-3">
        <h2 className="mb-1 flex items-baseline justify-between font-bold">
          Items <span className="text-xs font-normal text-slate-500">tap an item to change it</span>
        </h2>
        {split.items.length ? (
          <ul className="divide-y divide-slate-100">
            {split.items.map((it) => (
              <ItemLine
                key={it.id}
                item={it}
                editing={editing === it.id}
                onEdit={() => setEditing(editing === it.id ? '' : it.id)}
                onChange={(patch) => setItem(it.id, patch)}
                onRemove={() => { update({ ...clearItemOverrides(split, it.id), items: split.items.filter((x) => x.id !== it.id) }); setEditing(''); }}
              />
            ))}
          </ul>
        ) : (
          <div className="py-4 text-center text-sm text-slate-600">
            <p>No items on this bill yet.</p>
            <Button variant="dark" className="mt-3" icon={Divide} onClick={goEqual}>Just split it equally</Button>
          </div>
        )}
        {split.items.length > 0 && (
          <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
            Items {money(result.itemsSubtotal, region)}
            {Math.abs(result.extra) >= 0.01 ? ` + ${result.extra > 0 ? 'VAT / service charge' : 'discount'} ${money(Math.abs(result.extra), region)}` : ''} = bill {money(result.total, region)}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" icon={Plus} onClick={addItem}>Add item</Button>
          {readPhoto && <Button size="sm" variant="ghost" icon={reading ? LoaderCircle : ScanText} className={reading ? '[&_svg]:animate-spin' : ''} disabled={reading} onClick={readPhoto}>Read from photo</Button>}
          <Button size="sm" variant="ghost" icon={ClipboardPaste} onClick={() => setPaste((v) => !v)}>Paste text</Button>
        </div>
        {paste && (
          <div className="mt-3 space-y-2">
            <textarea rows={4} className="input font-mono text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder={'Chicken Momo 2 250 500\nTuborg 2 x 450 900'} aria-label="Bill text" />
            <Button size="sm" variant="dark" onClick={() => { update({ ...split, items: [...split.items, ...parseLineItemsFromText(text)] }); setPaste(false); setText(''); }}>Add these items</Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function PeopleStep({ split, update }) {
  const [friends, setFriends] = useState(loadFriends);
  const [groups, setGroups] = useState(loadGroups);
  const byItems = split.mode !== 'equal';
  const hasItems = split.items.length > 0;
  const inSplit = new Set(split.members.map((m) => m.name.trim().toLowerCase()));
  const others = split.members.filter((m) => !m.isPayer);
  const setMember = (id, patch, reTick = false) => {
    const base = reTick ? clearMemberOverrides(split, id) : split;
    update({ ...base, members: split.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  };
  const add = (list) => update({ ...split, members: [...split.members, ...list.filter((f) => !inSplit.has(f.name.trim().toLowerCase())).map((f) => makeMember(f))] });
  const remove = (id) => {
    const { [id]: _p, ...paid } = split.paid || {};
    update({ ...clearMemberOverrides(split, id), members: split.members.filter((m) => m.id !== id), paid });
  };
  const setCount = (n) => {
    const target = Math.max(1, Math.min(30, n));
    if (target > split.members.length) {
      const extra = [];
      for (let k = split.members.length + 1; k <= target; k++) {
        let name = `Friend ${k}`;
        for (let j = k; inSplit.has(name.toLowerCase()); j++) name = `Friend ${j + 1}`;
        inSplit.add(name.toLowerCase());
        extra.push(makeMember({ name, diet: 'non-veg' }));
      }
      update({ ...split, members: [...split.members, ...extra] });
    } else if (target < split.members.length) {
      const drop = others.slice(target - split.members.length).map((m) => m.id);
      let next = split;
      for (const id of drop) next = clearMemberOverrides(next, id);
      update({ ...next, members: split.members.filter((m) => !drop.includes(m.id)) });
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="mb-3 font-bold">How should it be split?</h2>
        <div className="grid grid-cols-2 gap-2">
          {[
            ['items', 'By what each had', 'Veg, non-veg and drinks are worked out per person', !hasItems],
            ['equal', 'Split equally', 'Everyone pays the same', false],
          ].map(([value, title, note, disabled]) => (
            <button
              key={value}
              type="button"
              disabled={disabled}
              aria-pressed={(value === 'equal') === !byItems}
              onClick={() => update({ ...split, mode: value })}
              className={`rounded-xl border-2 p-3 text-left transition disabled:opacity-40 ${(value === 'equal') === !byItems ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-800'}`}
            >
              <span className="block text-sm font-bold">{title}</span>
              <span className={`mt-0.5 block text-xs ${(value === 'equal') === !byItems ? 'text-slate-300' : 'text-slate-500'}`}>{disabled ? 'Add items first' : note}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-bold">How many people?</h2>
          <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1">
            <button type="button" onClick={() => setCount(split.members.length - 1)} disabled={split.members.length <= 1} className="flex size-9 items-center justify-center rounded-full bg-white shadow-sm disabled:opacity-40" aria-label="One person fewer"><Minus className="size-4" /></button>
            <span className="num w-8 text-center text-lg font-extrabold" aria-live="polite">{split.members.length}</span>
            <button type="button" onClick={() => setCount(split.members.length + 1)} className="flex size-9 items-center justify-center rounded-full bg-white shadow-sm" aria-label="One more person"><Plus className="size-4" /></button>
          </div>
        </div>
        <ul className="space-y-2">
          {split.members.map((m) => (
            <li key={m.id} className={`rounded-lg border p-2.5 ${m.out ? 'border-dashed border-slate-300 opacity-60' : 'border-slate-200'}`}>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={!m.out}
                  title={m.out ? 'Left out: tap to include' : 'In the split: tap to leave out'}
                  onClick={() => setMember(m.id, { out: !m.out })}
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 ${m.out ? 'border-slate-300 bg-white text-transparent' : 'border-emerald-600 bg-emerald-600 text-white'}`}
                  aria-label={`${m.name || 'Person'} ${m.out ? 'left out' : 'in the split'}`}
                >
                  ✓
                </button>
                <input className="input min-w-0 flex-1 py-1.5" value={m.name} onChange={(e) => update({ ...split, members: split.members.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)) })} aria-label="Name" />
                {m.isPayer ? <span className="shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-bold text-white">Paid</span>
                  : <button type="button" onClick={() => remove(m.id)} className="shrink-0 rounded-md p-1.5 text-slate-400 hover:text-brand" aria-label={`Remove ${m.name}`}><Trash className="size-4" /></button>}
              </div>
              {byItems && !m.out && (
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-9">
                  <Segmented value={m.diet} onChange={(diet) => setMember(m.id, { diet }, true)} options={[{ value: 'veg', label: 'Veg' }, { value: 'non-veg', label: 'Non-veg' }]} />
                  <button type="button" aria-pressed={m.alcohol} onClick={() => setMember(m.id, { alcohol: !m.alcohol }, true)} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ring-1 ring-inset ${m.alcohol ? 'bg-amber-100 text-amber-900 ring-amber-300' : 'bg-white text-slate-500 ring-slate-300'}`}>
                    <Beer className="size-4" />{m.alcohol ? 'Drinks' : 'No drinks'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {(friends.length > 0 || groups.length > 0 || others.length > 0) && (
          <details className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <summary className="cursor-pointer font-semibold text-slate-700">Saved friends & groups</summary>
            <div className="mt-2 space-y-2">
              {groups.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {groups.map((g) => (
                    <span key={g.name} className="inline-flex items-center rounded-full bg-navy/10 text-navy">
                      <button type="button" className="py-1 pl-3 pr-1 font-semibold" onClick={() => add(g.members)}>{g.name} ({g.members.length})</button>
                      <button type="button" className="px-2 py-1 text-navy/60" aria-label={`Delete group ${g.name}`} onClick={() => { deleteGroup(g.name); setGroups(loadGroups()); }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {friends.filter((f) => !inSplit.has(f.name.toLowerCase())).map((f) => (
                  <span key={f.name} className="inline-flex items-center rounded-full bg-white text-slate-800 ring-1 ring-slate-200">
                    <button type="button" className="py-1 pl-3 pr-1 font-semibold" onClick={() => add([f])}>+ {f.name}</button>
                    <button type="button" className="px-2 py-1 text-slate-400" aria-label={`Forget ${f.name}`} onClick={() => { forgetFriend(f.name); setFriends(loadFriends()); }}>×</button>
                  </span>
                ))}
              </div>
              {others.length > 0 && (
                <button type="button" className="text-xs font-semibold text-navy underline" onClick={() => { const n = window.prompt('Name this group (e.g. Office lunch)'); if (n?.trim()) { saveGroup(n, split.members); setGroups(loadGroups()); } }}>
                  Save these people as a group
                </button>
              )}
            </div>
          </details>
        )}
      </Card>
    </div>
  );
}

function SharesStep({ split, result, update, region, payerInfo }) {
  const [open, setOpen] = useState('');
  const [qrFor, setQrFor] = useState('');
  const byItems = split.mode !== 'equal';
  const owed = outstanding(split, result);
  return (
    <div className="space-y-4">
      <Card className="grid grid-cols-3 divide-x divide-slate-100 p-0 text-center">
        {[['Your share', result.myShare, 'text-slate-900'], ['To collect', result.recoverable, 'text-slate-900'], ['Still owed', owed, owed > 0 ? 'text-amber-700' : 'text-emerald-700']].map(([k, v, cls]) => (
          <div key={k} className="px-2 py-3">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{k}</div>
            <div className={`num text-lg font-extrabold ${cls}`}>{money(v, region)}</div>
          </div>
        ))}
      </Card>

      {result.unassigned > 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900 ring-1 ring-inset ring-amber-200">{money(result.unassigned, region)} isn’t assigned to anyone. Open “Fine-tune who had what” below.</p>}

      <Card className="px-4 py-2">
        <ul className="divide-y divide-slate-100">
          {result.members.filter((r) => !r.out).map((r) => (
            <li key={r.id} className="py-2.5">
              <div className="flex items-center gap-2">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === r.id ? '' : r.id)} aria-expanded={open === r.id}>
                  <span className="block truncate font-semibold">{r.name || 'Person'}{r.isPayer && <span className="font-normal text-slate-500"> (paid)</span>}</span>
                  {byItems && <span className="block text-xs text-slate-500">{r.lines.length} item{r.lines.length === 1 ? '' : 's'}{Math.abs(r.extra) >= 0.01 ? ` + ${r.extra > 0 ? 'VAT/SC' : 'discount'}` : ''} · tap for details</span>}
                </button>
                <span className="num text-lg font-extrabold">{money(r.share, region)}</span>
              </div>
              {!r.isPayer && r.share > 0 && (
                <div className="mt-2 flex gap-2">
                  {payerInfo && (
                    <button type="button" aria-expanded={qrFor === r.id} onClick={() => setQrFor(qrFor === r.id ? '' : r.id)} className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-bold ring-1 ring-inset ${qrFor === r.id ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-300'}`}>
                      <QrCode className="size-4" />Show QR
                    </button>
                  )}
                  <button type="button" aria-pressed={Boolean(split.paid?.[r.id])} onClick={() => update({ ...split, paid: { ...split.paid, [r.id]: !split.paid?.[r.id] } })} className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-bold ring-1 ring-inset ${split.paid?.[r.id] ? 'bg-emerald-50 text-emerald-800 ring-emerald-300' : 'bg-white text-slate-700 ring-slate-300'}`}>
                    <CircleCheck className="size-4" />{split.paid?.[r.id] ? 'Paid' : 'Mark paid'}
                  </button>
                </div>
              )}
              {qrFor === r.id && payerInfo && <MemberPayQr payer={payerInfo} amount={r.share} name={r.name} region={region} />}
              {open === r.id && (
                <ul className="mt-2 space-y-0.5 rounded-lg bg-slate-50 p-2.5 text-sm text-slate-600">
                  {r.lines.map((l) => <li key={l.itemId} className="flex justify-between gap-2"><span>{l.name}{l.of > 1 || l.weight > 1 ? ` (${l.weight}/${l.of})` : ''}</span><span className="num">{money(l.amount, region)}</span></li>)}
                  {r.lines.length > 0 && Math.abs(r.extra) >= 0.01 && <li className="flex justify-between gap-2"><span>{r.extra > 0 ? 'VAT / service charge' : 'Discount'}</span><span className="num">{r.extra > 0 ? '+' : '−'}{money(Math.abs(r.extra), region)}</span></li>}
                  {!r.lines.length && <li>{byItems ? 'No items' : `Equal share of ${money(result.total, region)}`}</li>}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {byItems && split.items.length > 0 && (
        <details className="card group">
          <summary className="cursor-pointer px-4 py-3 font-bold">Fine-tune who had what</summary>
          <div className="space-y-3 border-t border-slate-100 p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-600">VAT / service charge:</span>
              <Segmented value={split.taxMode || 'proportional'} onChange={(taxMode) => update({ ...split, taxMode })} options={[{ value: 'proportional', label: 'By what each had' }, { value: 'equal', label: 'Equally' }]} />
            </div>
            <Matrix split={split} update={update} />
          </div>
        </details>
      )}

      <ShareImage split={split} result={result} payerInfo={payerInfo} />
      {!payerInfo && <a href="#/settings" className="block rounded-lg bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-200"><HandCoins className="mr-1 inline size-4" />Add your payment QR in Settings so friends can scan it.</a>}
    </div>
  );
}

function ShareImage({ split, result, payerInfo }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const payer = { name: payerInfo?.payerName || result.members.find((m) => m.isPayer)?.name || '', qrText: payerInfo?.text || '', qrImage: payerInfo?.image || '', qrLabel: payerInfo?.label || '' };
  const fileName = `split_${(split.title || 'bill').replace(/[^\wऀ-ॿ]+/g, '_').slice(0, 30)}_${split.dateAD || ''}.png`;
  const canShareFiles = typeof navigator !== 'undefined' && navigator.canShare?.({ files: [new File([''], 'x.png', { type: 'image/png' })] });
  async function run(kind) {
    setBusy(kind);
    try {
      const blob = await drawSplitSummary({ split, result, payer });
      if (kind === 'share') await navigator.share({ files: [new File([blob], fileName, { type: 'image/png' })], title: `${split.title} split` });
      else { downloadBlob(blob, fileName); toast('Summary image downloaded.'); }
    } catch (e) {
      if (e.name !== 'AbortError') toast(kind === 'share' ? 'Sharing isn’t available here. Download the image instead.' : `Couldn’t draw the image: ${e.message}`, 'error');
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {canShareFiles && <Button variant="primary" size="lg" icon={busy === 'share' ? LoaderCircle : Share2} disabled={!!busy} onClick={() => run('share')} className="flex-1">Share to group chat</Button>}
      <Button variant={canShareFiles ? 'outline' : 'primary'} size="lg" icon={busy === 'image' ? LoaderCircle : ImageDown} disabled={!!busy} onClick={() => run('image')} className="flex-1">Download Split Summary Image (PNG)</Button>
    </div>
  );
}

export function SplitEditor({ billId }) {
  const { expenses, profile, saveExpense, settings } = useStore();
  const toast = useToast();
  const payerInfo = usePaymentQr();
  const expense = expenses.find((e) => e.id === billId);
  const [split, setSplit] = useState(() => (expense ? { ...newSplitForExpense(expense, profile), ...(expense.split || {}) } : null));
  // Coming back to a split that already has people opens on the shares; a new one starts at the bill.
  const [step, setStepState] = useState(() => (expense?.split?.members?.length > 1 ? 2 : 0));
  const [reading, setReading] = useState(false);
  const dirty = useRef(false);
  const total = Number(expense?.totalAmount) || 0;
  const live = useMemo(() => (split ? { ...split, total } : null), [split, total]);
  const result = useMemo(() => (live ? computeSplit(live) : null), [live]);

  // Autosave into the bill: the full amount stays the bill total (IRD); shares are tracked alongside.
  useEffect(() => {
    if (!dirty.current || !live || !expense) return undefined;
    const t = setTimeout(() => {
      saveExpense({ ...expense, split: { ...live, myShare: result.myShare, recoverable: result.recoverable, outstanding: outstanding(live, result), updatedAt: new Date().toISOString() } });
      rememberFriends(live.members);
    }, 500);
    return () => clearTimeout(t);
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!expense) return <Card><EmptyState icon={ReceiptText} title="Bill not found" action={<a href="#/split" className="font-semibold text-navy underline">Back to Split Khata</a>} /></Card>;

  const update = (next) => { dirty.current = true; setSplit(next); };
  const setStep = (n) => { setStepState(Math.max(0, Math.min(2, n))); window.scrollTo({ top: 0 }); };

  async function readPhoto() {
    setReading(true);
    try {
      const [{ prepareForOcr }, { extractBill }] = await Promise.all([import('../lib/image.js'), import('../lib/ocr/index.js')]);
      const out = await extractBill(await prepareForOcr(expense.receiptImage), settings, { region: profile.region });
      const found = out.fields.lineItems || [];
      if (!found.length) toast('No item rows found on the photo. Add them by hand or paste the text.', 'error');
      else { update({ ...split, items: [...split.items, ...found], mode: 'items' }); toast(`Added ${found.length} items. Check them against the bill.`); }
    } catch (e) {
      toast(`Couldn’t read the photo: ${e.message}`, 'error');
    } finally {
      setReading(false);
    }
  }

  async function removeSplit() {
    if (!window.confirm('Remove this split? The bill stays in your ledger.')) return;
    const { split: _drop, ...rest } = expense;
    await saveExpense(rest);
    window.location.hash = '#/split';
  }

  const people = live.members.filter((m) => !m.out).length;
  const next = [
    { label: 'Next: people', go: () => setStep(1) },
    people < 2
      ? { label: 'Add a person', go: () => update({ ...split, members: [...split.members, makeMember({ name: `Friend ${split.members.length + 1}` })] }) }
      : { label: 'See shares', go: () => setStep(2) },
    { label: 'Done', go: () => { window.location.hash = '#/split'; } },
  ][step];

  return (
    <div className="mx-auto max-w-xl pb-24 md:pb-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <a href="#/split" className="text-sm font-semibold text-slate-600">← All splits</a>
        {expense.split && <button type="button" onClick={removeSplit} className="text-xs font-semibold text-slate-500 underline">Remove split</button>}
      </div>
      <div className="sticky top-14 z-20 -mx-4 mb-4 bg-slate-100/95 px-4 pb-2 pt-1 backdrop-blur md:top-0">
        <h1 className="mb-2 truncate text-lg font-bold">Split: {expense.merchantName || 'Bill'}</h1>
        <Stepper step={step} setStep={setStep} />
      </div>

      {step === 0 && <BillStep expense={expense} split={split} update={update} result={result} region={profile.region} readPhoto={expense.receiptImage ? readPhoto : null} reading={reading} goEqual={() => { update({ ...split, mode: 'equal' }); setStep(1); }} />}
      {step === 1 && <PeopleStep split={split} update={update} />}
      {step === 2 && <SharesStep split={live} result={result} update={update} region={profile.region} payerInfo={payerInfo} />}

      {/* Back / Next: pinned above the bottom bar on phones, inline on desktop. */}
      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:static md:mt-5 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <div className="mx-auto flex max-w-xl gap-2">
          {step > 0 && <Button size="lg" variant="outline" onClick={() => setStep(step - 1)}>Back</Button>}
          <Button size="lg" variant="dark" className="flex-1" onClick={next.go}>{next.label}</Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- shared links (turned off) ---------------- */

/**
 * Split links (#/split/<token>) are switched off: a page on this domain would show whatever
 * payment QR a link carries, so anyone could craft one with their own QR. Old or forged links
 * land here and show nothing from the link.
 */
export function SplitShare() {
  return (
    <Card>
      <EmptyState icon={ShieldAlert} title="Split links are turned off">
        BillKhata no longer opens shared split links, because a link can’t prove who made it and could carry someone else’s payment QR.
        Ask the person who paid to send you the split summary image instead, and only pay a QR you trust.
      </EmptyState>
    </Card>
  );
}
