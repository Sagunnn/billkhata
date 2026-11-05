// Split Khata: hub (#/split), editor (#/split-bill/<billId>) and read-only shared view (#/split/<token>).
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight, Banknote, Beer, Check, ChevronLeft, Crown, ScanLine, ChevronRight, ClipboardPaste, Copy, Divide, Drumstick, HandCoins, ImageUp, Leaf,
  LoaderCircle, Minus, Pencil, Plus, Luggage, QrCode, ReceiptText, RotateCcw, ScanText, ShieldAlert, Split as SplitIcon, Trash, Utensils,
  UsersRound, Wine, X, Zap, FileUp, Send,
} from 'lucide-react';
import { CATEGORIES } from '../lib/constants.js';
import { money, downloadBlob } from '../lib/format.js';
import { formatAD, formatBS, shortBS, todayAD } from '../lib/nepaliDate.js';
import { deleteGroup, forgetFriend, loadFriends, loadGroups, loadPaymentQr, rememberFriends, saveGroup } from '../lib/profile.js';
import { payNumberFor } from '../lib/qr.js';
import {
  autoWeight, clearItemOverrides, clearMemberOverrides, computeSplit, makeItem, makeMember,
  newSplitForExpense, outstanding, parseLineItemsFromText, splitText, TAG_LABELS, TAGS, weightOf,
} from '../lib/splitter.js';
import { drawSplitSummary } from '../lib/splitImage.js';
import { useStore } from '../store.jsx';
import { QrBox, usePaymentQr } from '../components/PaymentQr.jsx';
import { useToast } from '../components/Toast.jsx';
import { Badge, Button, Card, CopyButton, EmptyState, Modal, Notice, Segmented } from '../components/ui.jsx';
import { ReceivedSplits, sendShareFile } from '../components/ShareFiles.jsx';
import { shareFileName, splitShareFile } from '../lib/share.js';

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
  const { expenses, profile, openSheet } = useStore();
  const qr = usePaymentQr();
  const splits = expenses.filter((e) => e.split).sort((a, b) => (b.split.updatedAt || '').localeCompare(a.split.updatedAt || ''));
  const food = CATEGORIES[0];
  const candidates = expenses
    .filter((e) => !e.split && Number(e.totalAmount) > 0)
    .sort((a, b) => (b.category === food) - (a.category === food) || (b.billDateAD || '').localeCompare(a.billDateAD || ''))
    .slice(0, 8);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="t-h-l text-ink">Split</h1>
        <p className="t-label mt-1 text-ink-2">Share a bill between friends, or keep a whole trip’s bills and settle up.</p>
      </div>
      <a href="#/scan?split" className="tap flex items-center gap-3 rounded-2xl bg-brand p-4 text-on-brand shadow-sm hover:bg-brand-dark">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-[rgba(255,255,255,0.18)]"><ScanLine className="size-6" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold">Scan a bill to split</span>
          <span className="block text-[13px] opacity-85">Read the items, then pick who had what</span>
        </span>
        <ChevronRight className="size-5 shrink-0" />
      </a>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <a href="#split-pick" onClick={(ev) => { ev.preventDefault(); document.getElementById('split-pick')?.scrollIntoView({ behavior: 'smooth' }); }} className="card flex flex-col gap-2 rounded-2xl p-4 hover:border-line-strong">
          <span className="flex size-10 items-center justify-center rounded-[12px] bg-brand-soft text-brand"><Divide className="size-5" /></span>
          <span className="text-[15px] font-semibold text-ink">Split a saved bill</span>
          <span className="t-caption text-ink-3">One you’ve already scanned or added</span>
        </a>
        <button type="button" onClick={() => openSheet('quickOut', { split: true })} className="card flex flex-col gap-2 rounded-2xl p-4 text-left hover:border-line-strong">
          <span className="flex size-10 items-center justify-center rounded-[12px] bg-leaf-soft text-leaf"><Zap className="size-5" /></span>
          <span className="text-[15px] font-semibold text-ink">Quick expense</span>
          <span className="t-caption text-ink-3">No bill: a taxi, snacks you paid for friends</span>
        </button>
        <a href="#/trips" className="card col-span-2 flex items-center gap-3 rounded-2xl p-4 hover:border-line-strong sm:col-span-1 sm:flex-col sm:items-start sm:gap-2">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-marigold-soft text-marigold-ink"><Luggage className="size-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-ink">Start a trip</span>
            <span className="t-caption block text-ink-3">Many bills, many payers, fewest payments to settle</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-ink-3 sm:hidden" />
        </a>
      </div>
      <button type="button" onClick={() => openSheet('receive')} className="t-label flex w-full items-center justify-center gap-2 rounded-[14px] border border-dashed border-line-strong py-3 font-medium text-ink-2 hover:bg-sunken">
        <FileUp className="size-4" />Open a file from a friend
      </button>
      <ReceivedSplits />
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
      <Card id="split-pick" className="scroll-mt-6">
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

const GROUPS = ['veg', 'non-veg', 'alcohol', 'shared'];

/**
 * "Who had what", one person at a time: pick someone, see the bill's items grouped into Veg,
 * Non-veg, Drinks and Shared, and tick what they had. Items a vegetarian or non-drinker wouldn't
 * have are folded away. Each item lists only the people actually on it.
 */
function FineTuneModal({ split, update, region, onClose }) {
  const people = split.members.filter((m) => !m.out);
  const [who, setWho] = useState(() => (people.find((m) => !m.isPayer) || people[0])?.id);
  const [showHidden, setShowHidden] = useState({});
  const person = people.find((m) => m.id === who) || people[0];
  const result = computeSplit(split);
  const row = result.members.find((r) => r.id === person?.id);
  const partOf = Object.fromEntries((row?.lines || []).map((l) => [l.itemId, l.amount]));
  const nameOf = Object.fromEntries(people.map((m) => [m.id, m.name || 'Person']));

  const setWeight = (item, member, w) => {
    const rowOverrides = { ...(split.overrides?.[item.id] || {}) };
    if (w === autoWeight(item.tag, member)) delete rowOverrides[member.id];
    else rowOverrides[member.id] = Math.max(0, w);
    const overrides = { ...split.overrides, [item.id]: rowOverrides };
    if (!Object.keys(rowOverrides).length) delete overrides[item.id];
    update({ ...split, overrides });
  };

  if (!person) return null;
  const hiddenReason = (tag) => {
    if (tag === 'non-veg' && person.diet === 'veg') return `${person.name || 'They'} ${person.name ? 'is' : 'are'} vegetarian`;
    if (tag === 'alcohol' && !person.alcohol) return `${person.name || 'They'} ${person.name ? 'doesn’t' : 'don’t'} drink`;
    return '';
  };

  return (
    <Modal open onClose={onClose} title="Who had what" size="md" footer={<Button variant="dark" className="w-full sm:w-auto" onClick={onClose}>Done</Button>}>
      <div className="space-y-4">
        <div>
          <label htmlFor="ft-person" className="label">Person</label>
          <select id="ft-person" className="input text-base font-semibold" value={person.id} onChange={(e) => setWho(e.target.value)}>
            {people.map((m) => <option key={m.id} value={m.id}>{m.name || 'Person'}{m.isPayer ? ' (paid)' : ''} · {m.diet === 'veg' ? 'Veg' : 'Non-veg'}{m.alcohol ? ' · drinks' : ''}</option>)}
          </select>
          <p className="mt-2 text-sm text-slate-600">
            {person.name || 'They'} pay{person.name ? 's' : ''} <b className="num text-slate-900">{money(row?.share || 0, region)}</b>
            {row && Math.abs(row.extra) >= 0.01 ? ` (items ${money(row.subtotal, region)} ${row.extra > 0 ? '+ VAT/SC' : '− discount'})` : ''}
          </p>
        </div>

        {GROUPS.map((tag) => {
          const items = split.items.filter((it) => it.tag === tag);
          if (!items.length) return null;
          const reason = hiddenReason(tag);
          const folded = reason && !showHidden[tag];
          const had = items.filter((it) => weightOf(split, it, person) > 0).length;
          return (
            <section key={tag}>
              <div className="mb-1.5 flex items-center gap-2">
                <TagChip tag={tag} />
                <span className="text-xs font-semibold text-slate-500">{had} of {items.length} ticked</span>
                {reason && (
                  <button type="button" className="ml-auto text-xs font-semibold text-navy underline" onClick={() => setShowHidden((x) => ({ ...x, [tag]: !x[tag] }))}>
                    {folded ? 'Show' : 'Hide'}
                  </button>
                )}
              </div>
              {folded ? (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Hidden: {reason}.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {items.map((it) => {
                    const w = weightOf(split, it, person);
                    const withWhom = people.filter((m) => m.id !== person.id && weightOf(split, it, m) > 0).map((m) => nameOf[m.id]);
                    return (
                      <li key={it.id} className="flex items-center gap-3 px-3 py-2.5">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={w > 0}
                          aria-label={`${person.name || 'Person'} had ${it.name}`}
                          onClick={() => setWeight(it, person, w > 0 ? 0 : 1)}
                          className={`flex size-7 shrink-0 items-center justify-center rounded-md border-2 text-sm font-bold ${w > 0 ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-transparent'}`}
                        >
                          ✓
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">{it.name || 'Item'}{it.qty > 1 ? <span className="font-normal text-slate-500"> ×{it.qty}</span> : null}</div>
                          <div className="truncate text-xs text-slate-500">
                            {w > 0
                              ? (withWhom.length ? `with ${withWhom.join(', ')}` : 'only them')
                              : (withWhom.length ? `${withWhom.join(', ')}` : 'nobody yet')}
                          </div>
                        </div>
                        {w > 0 && it.qty > 1 && (
                          <span className="flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5" title="How many of these they had">
                            <button type="button" className="flex size-6 items-center justify-center rounded-full bg-white" aria-label="One less" onClick={() => setWeight(it, person, Math.max(1, w - 1))}><Minus className="size-3" /></button>
                            <span className="num w-6 text-center text-xs font-bold">×{w}</span>
                            <button type="button" className="flex size-6 items-center justify-center rounded-full bg-white" aria-label="One more" onClick={() => setWeight(it, person, w + 1)}><Plus className="size-3" /></button>
                          </span>
                        )}
                        <span className="num w-16 text-right text-sm">
                          <span className="block font-semibold">{money(it.amount, region)}</span>
                          {w > 0 && <span className="block text-xs text-slate-500">{money(partOf[it.id] || 0, region)}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm">
          <span className="text-slate-600">VAT / service charge</span>
          <Segmented value={split.taxMode || 'proportional'} onChange={(taxMode) => update({ ...split, taxMode })} options={[{ value: 'proportional', label: 'By what each had' }, { value: 'equal', label: 'Equally' }]} />
        </div>
      </div>
    </Modal>
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
    <ol className="flex gap-2" aria-label="Steps">
      {STEPS.map((label, i) => {
        const done = i < step;
        return (
          <li key={label} className="flex-1">
            <button type="button" onClick={() => setStep(i)} aria-current={step === i ? 'step' : undefined}
              className={`flex w-full flex-col items-start gap-1.5 text-left text-[13px] font-medium leading-4 ${step === i ? 'text-ink' : done ? 'text-ink-2' : 'text-ink-3'}`}>
              <span className={`h-1 w-full rounded-full ${step === i ? 'bg-brand' : done ? 'bg-leaf' : 'bg-line'}`} />
              <span className="flex items-center gap-1">{done && <Check className="size-3.5 text-leaf" />}{label}</span>
            </button>
          </li>
        );
      })}
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

function PeopleStep({ split, update, onNext, nextLabel }) {
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
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-200/70 p-1" role="radiogroup" aria-label="How to split">
        {[['items', 'By what each had', !hasItems], ['equal', 'Split equally', false]].map(([value, title, disabled]) => {
          const on = (value === 'equal') === !byItems;
          return (
            <button key={value} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => update({ ...split, mode: value })}
              className={`rounded-lg py-2.5 text-sm font-bold transition disabled:opacity-40 ${on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>
              {title}
            </button>
          );
        })}
      </div>

      <Card className="p-4">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="font-bold">People</h2>
          <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1">
            <button type="button" onClick={() => setCount(split.members.length - 1)} disabled={split.members.length <= 1} className="flex size-8 items-center justify-center rounded-full bg-white shadow-sm disabled:opacity-40" aria-label="One person fewer"><Minus className="size-4" /></button>
            <span className="num w-7 text-center font-extrabold" aria-live="polite">{split.members.length}</span>
            <button type="button" onClick={() => setCount(split.members.length + 1)} className="flex size-8 items-center justify-center rounded-full bg-white shadow-sm" aria-label="One more person"><Plus className="size-4" /></button>
          </div>
        </div>
        <ul className="divide-y divide-slate-100">
          {split.members.map((m) => (
            <li key={m.id} className="flex items-center gap-2.5 py-2.5">
              <button
                type="button"
                aria-pressed={!m.out}
                onClick={() => setMember(m.id, { out: !m.out })}
                title={m.out ? 'Left out: tap to include' : 'In the split: tap to leave out'}
                aria-label={`${m.name || 'Person'}: ${m.out ? 'left out, tap to include' : 'in the split, tap to leave out'}`}
                className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${m.out ? 'bg-slate-100 text-slate-400 line-through' : m.isPayer ? 'bg-brand text-white' : 'bg-slate-900 text-white'}`}
              >
                {(m.name.trim()[0] || '?').toUpperCase()}
              </button>
              <div className="min-w-0 flex-1">
                <input
                  className={`w-full truncate rounded bg-transparent text-sm font-semibold outline-none focus:bg-slate-50 focus:px-1 ${m.out ? 'text-slate-400' : 'text-slate-900'}`}
                  value={m.name}
                  onChange={(e) => update({ ...split, members: split.members.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)) })}
                  aria-label="Name"
                  enterKeyHint="done"
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                />
                {(m.out || m.isPayer) && <div className="text-xs text-slate-500">{m.out ? 'Left out' : 'Paid the bill'}</div>}
              </div>
              {byItems && !m.out && (
                <>
                  <button type="button" onClick={() => setMember(m.id, { diet: m.diet === 'veg' ? 'non-veg' : 'veg' }, true)} aria-label={`${m.name}: ${m.diet === 'veg' ? 'veg' : 'non-veg'}, tap to switch`}
                    className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-bold ring-1 ring-inset ${m.diet === 'veg' ? 'bg-emerald-50 text-emerald-800 ring-emerald-300' : 'bg-red-50 text-red-800 ring-red-200'}`}>
                    {m.diet === 'veg' ? <Leaf className="size-3.5" /> : <Drumstick className="size-3.5" />}{m.diet === 'veg' ? 'Veg' : 'Non-veg'}
                  </button>
                  <button type="button" aria-pressed={m.alcohol} onClick={() => setMember(m.id, { alcohol: !m.alcohol }, true)} title={m.alcohol ? 'Drinks: yes' : 'Drinks: no'} aria-label={`${m.name}: ${m.alcohol ? 'drinks' : 'no drinks'}, tap to switch`}
                    className={`relative flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${m.alcohol ? 'bg-amber-100 text-amber-900 ring-amber-300' : 'bg-white text-slate-300 ring-slate-200'}`}>
                    <Beer className="size-4" />
                    {!m.alcohol && <span className="absolute h-0.5 w-5 rotate-45 rounded bg-slate-300" />}
                  </button>
                </>
              )}
              {m.isPayer ? (
                <span className="shrink-0 rounded-full p-1 text-marigold" title="Paid the bill: always in the split" aria-label="Paid the bill, can't be removed"><Crown className="size-4" /></span>
              ) : (
                <button type="button" onClick={() => remove(m.id)} className="shrink-0 rounded-full p-1 text-slate-300 hover:text-brand" aria-label={`Remove ${m.name}`}><Trash className="size-4" /></button>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">Tap a name to rename, its circle to leave someone out.{byItems ? ' Veg and the beer button decide who shares which items; fine-tune it under Shares.' : ''}</p>
        {/* While a name is being typed the pinned bar steps aside for the keyboard: Next is here instead. */}
        {onNext && (
          <div className="show-typing mt-3">
            <Button variant="primary" size="lg" className="w-full" onMouseDown={(e) => e.preventDefault()} onClick={onNext}>{nextLabel}</Button>
          </div>
        )}

        {(friends.length > 0 || groups.length > 0 || others.length > 0) && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-semibold text-navy">Saved friends & groups</summary>
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
                  <span key={f.name} className="inline-flex items-center rounded-full bg-slate-100 text-slate-800">
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

const AVATAR = ['bg-brand-soft text-brand', 'bg-leaf-soft text-leaf', 'bg-navy-soft text-navy', 'bg-marigold-soft text-marigold-ink', 'bg-sunken text-ink-2'];

/** A preference that recalculates the shares when tapped: Non-veg ⇄ Veg, Drinks ⇄ No drinks. */
function PrefPill({ on, onIcon: OnIcon, offIcon: OffIcon, onLabel, offLabel, onTone, offTone, onClick, who }) {
  return (
    <button type="button" onClick={onClick} aria-label={`${who}: ${on ? onLabel : offLabel}. Tap to switch.`}
      className={`tap inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium ${on ? onTone : offTone}`}>
      {on ? <OnIcon className="size-3.5" /> : <OffIcon className="size-3.5" />}{on ? onLabel : offLabel}<ArrowLeftRight className="size-3 opacity-60" />
    </button>
  );
}

function SharesStep({ split, result, update, region, payerInfo, goPeople }) {
  const [tuning, setTuning] = useState(false);
  const [qrFor, setQrFor] = useState('');
  const [changed, setChanged] = useState(null); // { id, text, before: { id: share } }
  const byItems = split.mode !== 'equal';
  const people = result.members.filter((r) => !r.out);
  const others = people.filter((r) => !r.isPayer && r.share > 0);
  const paidBack = others.filter((r) => split.paid?.[r.id]).length;

  function switchPref(r, patch, text) {
    const before = Object.fromEntries(result.members.map((m) => [m.id, m.share]));
    update({ ...clearMemberOverrides(split, r.id), members: split.members.map((m) => (m.id === r.id ? { ...m, ...patch } : m)) });
    setChanged({ id: r.id, text, before });
  }
  const moved = changed ? people.filter((r) => Math.abs((changed.before[r.id] ?? r.share) - r.share) >= 0.01).length : 0;
  const markPaid = (r, on) => update({ ...split, paid: { ...split.paid, [r.id]: on ? todayAD() : false } });

  return (
    <div className="space-y-4">
      <Card className="rounded-[20px] p-4">
        <div className="grid grid-cols-3 gap-2">
          <div><p className="t-caption text-ink-3">Your share</p><p className="num font-nepali text-[18px] font-semibold text-ink">{money(result.myShare, region)}</p></div>
          <div><p className="t-caption text-ink-3">To collect</p><p className="num font-nepali text-[18px] font-semibold text-ink">{money(result.recoverable, region)}</p></div>
          <div><p className="t-caption text-ink-3">Paid back</p><p className={`text-[18px] font-semibold ${others.length && paidBack === others.length ? 'text-leaf' : 'text-ink'}`}>{paidBack} of {others.length}</p></div>
        </div>
        <div className="mt-3 flex items-start gap-2 border-t border-dashed border-line pt-3">
          {byItems ? <Utensils className="mt-0.5 size-4 shrink-0 text-ink-2" /> : <Divide className="mt-0.5 size-4 shrink-0 text-ink-2" />}
          <p className="t-label flex-1 text-ink-2">{byItems ? `By what each had · VAT shared ${split.taxMode === 'equal' ? 'equally' : 'in proportion'}` : 'Split equally'}</p>
          <button type="button" onClick={goPeople} className="text-[14px] font-medium text-brand hover:underline">Change</button>
        </div>
        {changed && moved > 0 && (
          <p className="t-label mt-3 flex items-start gap-2 rounded-[12px] bg-navy-soft px-3 py-2 text-navy" role="status">
            <RotateCcw className="mt-0.5 size-4 shrink-0" />{changed.text} · {moved} share{moved === 1 ? '' : 's'}{payerInfo ? ' and QR amounts' : ''} updated
          </p>
        )}
      </Card>

      {result.unassigned > 0 && <Notice tone="warning" title={`${money(result.unassigned, region)} isn’t assigned to anyone`}>Tap “Fine-tune who had what” below.</Notice>}

      <Card className="rounded-[20px] p-2">
        <ul className="divide-y divide-line">
          {people.map((r, i) => {
            const m = split.members.find((x) => x.id === r.id) || {};
            const was = changed && r.id === changed.id && Math.abs((changed.before[r.id] ?? r.share) - r.share) >= 0.01 ? changed.before[r.id] : null;
            const paid = split.paid?.[r.id];
            return (
              <li key={r.id} className={`rounded-[14px] p-3 ${changed?.id === r.id && moved ? 'bg-navy-soft' : ''}`}>
                <div className="flex items-center gap-3">
                  <span className={`flex size-10 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold ${AVATAR[i % AVATAR.length]}`}>{(r.name.trim()[0] || '?').toUpperCase()}</span>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{r.name || 'Person'}{r.isPayer ? ' (you)' : ''}</span>
                  <span className="text-right">
                    <span className="num block font-nepali text-[16px] font-semibold text-ink">{money(r.share, region)}</span>
                    {was != null && <span className="num block text-[12px] text-ink-3">was <s>{money(was, region)}</s></span>}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 pl-[52px]">
                  {byItems && (
                    <>
                      <PrefPill who={r.name} on={m.diet !== 'veg'} onIcon={Drumstick} offIcon={Leaf} onLabel="Non-veg" offLabel="Veg"
                        onTone="border-brand/40 bg-brand-soft text-brand" offTone="border-leaf/40 bg-leaf-soft text-leaf"
                        onClick={() => switchPref(r, { diet: m.diet === 'veg' ? 'non-veg' : 'veg' }, `${r.name} switched to ${m.diet === 'veg' ? 'Non-veg' : 'Veg'}`)} />
                      <PrefPill who={r.name} on={Boolean(m.alcohol)} onIcon={Wine} offIcon={X} onLabel="Drinks" offLabel="No drinks"
                        onTone="border-navy/40 bg-navy-soft text-navy" offTone="border-line-strong bg-sunken text-ink-2"
                        onClick={() => switchPref(r, { alcohol: !m.alcohol }, `${r.name} ${m.alcohol ? 'had no drinks' : 'had drinks'}`)} />
                    </>
                  )}
                  {r.isPayer && <Badge tone="neutral" icon={Banknote}>You paid the bill</Badge>}
                  {!r.isPayer && paid && (
                    <button type="button" onClick={() => markPaid(r, false)} title="Tap to undo"><Badge tone="success" icon={Check}>Paid back{typeof paid === 'string' ? ` · ${shortBS(paid)}` : ''}</Badge></button>
                  )}
                </div>
                {!r.isPayer && !paid && r.share > 0 && (
                  <div className="mt-3 flex gap-2">
                    <Button className="flex-1" icon={QrCode} aria-expanded={qrFor === r.id} onClick={() => setQrFor(qrFor === r.id ? '' : r.id)} disabled={!payerInfo} title={payerInfo ? '' : 'Add your payment QR in Settings'}>
                      Collect {money(r.share, region)}
                    </Button>
                    <Button variant="ghost" icon={Check} onClick={() => markPaid(r, true)}>Mark paid</Button>
                  </div>
                )}
                {qrFor === r.id && payerInfo && !paid && <MemberPayQr payer={payerInfo} amount={r.share} name={r.name} region={region} />}
                {byItems && r.lines.length > 0 && (
                  <details className="mt-2 pl-[52px] text-[13px] text-ink-2">
                    <summary className="cursor-pointer text-ink-3">{r.lines.length} item{r.lines.length === 1 ? '' : 's'}{Math.abs(r.extra) >= 0.01 ? ` + ${r.extra > 0 ? 'VAT/SC' : 'discount'}` : ''}</summary>
                    <ul className="mt-1 space-y-0.5">
                      {r.lines.map((l) => <li key={l.itemId} className="flex justify-between gap-2"><span>{l.name}{l.of > 1 || l.weight > 1 ? ` (${l.weight}/${l.of})` : ''}</span><span className="num">{money(l.amount, region)}</span></li>)}
                      {Math.abs(r.extra) >= 0.01 && <li className="flex justify-between gap-2"><span>{r.extra > 0 ? 'VAT / service charge' : 'Discount'}</span><span className="num">{r.extra > 0 ? '+' : '−'}{money(Math.abs(r.extra), region)}</span></li>}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {byItems && split.items.length > 0 && people.length > 1 && (
        <button type="button" onClick={() => setTuning(true)} className="card flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left hover:border-line-strong">
          <Pencil className="size-5 text-ink-2" />
          <span className="flex-1">
            <span className="block text-[15px] font-medium text-ink">Fine-tune who had what</span>
            <span className="t-caption block text-ink-3">Tick items per person, ×2 for shared plates</span>
          </span>
          <ChevronRight className="size-5 text-ink-3" />
        </button>
      )}
      {tuning && <FineTuneModal split={split} update={update} region={region} onClose={() => setTuning(false)} />}
      {!payerInfo && <Notice tone="info" icon={HandCoins} title="Add your payment QR" action={<a href="#/settings" className="text-[14px] font-medium text-brand underline">Open Settings</a>}>So friends can scan it to pay you back.</Notice>}
    </div>
  );
}

/** Pinned under the shares: the summary image (shared or downloaded) and a plain-text summary. */
function ShareBar({ split, result, payerInfo, expense }) {
  const toast = useToast();
  const { profile } = useStore();
  const [busy, setBusy] = useState(false);
  const payer = { name: payerInfo?.payerName || result.members.find((m) => m.isPayer)?.name || '', qrText: payerInfo?.text || '', qrImage: payerInfo?.image || '', qrLabel: payerInfo?.label || '' };
  const fileName = `split_${(split.title || 'bill').replace(/[^\wऀ-ॿ]+/g, '_').slice(0, 30)}_${split.dateAD || ''}.png`;
  async function sendImage() {
    setBusy(true);
    try {
      const blob = await drawSplitSummary({ split, result, payer });
      const file = new File([blob], fileName, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: `${split.title} split` });
      else { downloadBlob(blob, fileName); toast('Summary image downloaded. Send it to the group.'); }
    } catch (e) {
      if (e.name !== 'AbortError') toast(`Couldn’t make the image: ${e.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }
  const pay = payNumberFor(loadPaymentQr(), profile);
  const date = split.dateBS ? formatBS(split.dateBS).replace(/ \d{4}$/, '') : split.dateAD ? formatAD(split.dateAD) : '';
  const text = splitText(split, result, { payerName: payer.name, pay, date });
  return (
    <div className="flex flex-col gap-2">
      <Button variant="primary" size="lg" icon={busy ? LoaderCircle : ImageUp} disabled={busy} onClick={sendImage}>Send summary image</Button>
      <CopyButton value={text} label="Copy text summary" copiedLabel="Copied" size="lg" icon={Copy} toastText={pay ? 'Summary copied. Paste it in the group chat.' : 'Summary copied. Add your eSewa number in Settings to include where to pay.'} />
      <button type="button" className="t-label inline-flex items-center justify-center gap-1.5 py-1 font-medium text-brand" onClick={async () => {
        const how = await sendShareFile(splitShareFile({ ...expense, split }, result, { payer, pay }), shareFileName('split', split.title), `${split.title} split`);
        if (how === 'downloaded') toast('Split file downloaded. Friends with BillKhata open it under Split → Open a file from a friend.');
      }}>
        <Send className="size-4" />Send to friends who use BillKhata
      </button>
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
  const [step, setStepState] = useState(() => (expense?.split?.members?.length > 1 ? 2 : expense && !expense.lineItems?.length && !expense.receiptImage ? 1 : 0));
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

  // The bill's items come in by themselves: the ones the scan read, or (a new split of a bill whose
  // scan found none) read from its photo now. Splitting equally stays one tap away.
  const readPhotoRef = useRef(null);
  useEffect(() => {
    if (!expense || !split || split.items.length) return;
    if (expense.lineItems?.length) {
      dirty.current = true;
      setSplit((sp) => ({ ...sp, mode: 'items', items: expense.lineItems.map((it) => makeItem(it)) }));
    } else if (expense.receiptImage && !expense.split) {
      readPhotoRef.current?.({ auto: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!expense) return <Card><EmptyState icon={ReceiptText} title="Bill not found" action={<a href="#/split" className="font-semibold text-navy underline">Back to Split Khata</a>} /></Card>;

  const update = (next) => { dirty.current = true; setSplit(next); };
  const setStep = (n) => { setStepState(Math.max(0, Math.min(2, n))); window.scrollTo({ top: 0 }); };

  readPhotoRef.current = readPhoto;
  async function readPhoto({ auto = false } = {}) {
    setReading(true);
    try {
      const [{ prepareForOcr }, { extractBill }] = await Promise.all([import('../lib/image.js'), import('../lib/ocr/index.js')]);
      const out = await extractBill(await prepareForOcr(expense.receiptImage), settings, { region: profile.region });
      const found = out.fields.lineItems || [];
      if (!found.length) toast(auto ? 'No item rows found on the bill’s photo, so it’s split equally. Add items by hand to split by what each had.' : 'No item rows found on the photo. Add them by hand or paste the text.', auto ? 'success' : 'error');
      else {
        dirty.current = true;
        setSplit((sp) => ({ ...sp, items: [...sp.items, ...found], mode: 'items' }));
        toast(`Read ${found.length} items from the bill’s photo. Check them against the bill.`);
      }
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
    <div className="mx-auto max-w-xl pb-36 md:pb-0">
      <div className="mb-4 flex items-center gap-2">
        <a href="#/split" aria-label="All splits" className="tap -ml-2 flex size-10 items-center justify-center rounded-full text-ink hover:bg-sunken"><ChevronLeft className="size-6" /></a>
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-semibold leading-6 text-ink">Split the bill</h1>
          <p className="t-caption num truncate text-ink-3">{expense.merchantName || 'Bill'} · {money(total, profile.region)}</p>
        </div>
        {expense.split && <Button size="sm" variant="danger" icon={Trash} onClick={removeSplit} className="shrink-0">Remove split</Button>}
      </div>
      <div className="mb-4"><Stepper step={step} setStep={setStep} /></div>

      {step === 0 && <BillStep expense={expense} split={split} update={update} result={result} region={profile.region} readPhoto={expense.receiptImage ? readPhoto : null} reading={reading} goEqual={() => { update({ ...split, mode: 'equal' }); setStep(1); }} />}
      {step === 1 && <PeopleStep split={split} update={update} onNext={next.go} nextLabel={next.label} />}
      {step === 2 && <SharesStep split={live} result={result} update={update} region={profile.region} payerInfo={payerInfo} goPeople={() => setStep(1)} />}

      {/* Pinned above the bottom bar on phones, inline on desktop. */}
      <div className="hide-typing fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:static md:mt-5 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <div className="mx-auto max-w-xl">
          {step === 2 ? <ShareBar split={live} result={result} payerInfo={payerInfo} expense={expense} /> : (
            <div className="flex gap-2">
              {step > 0 && <Button size="lg" onClick={() => setStep(step - 1)}>Back</Button>}
              <Button size="lg" variant="primary" className="flex-1" onClick={next.go}>{next.label}</Button>
            </div>
          )}
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
        Ask the person who paid to send it with <b>Send to friends who use BillKhata</b> (a file you open in Split), or the summary image, and only pay a QR you trust.
      </EmptyState>
    </Card>
  );
}
