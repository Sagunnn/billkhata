// Split Khata: hub (#/split), editor (#/split-bill/<billId>) and read-only shared view (#/split/<token>).
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Beer, CircleCheck, ClipboardPaste, Divide, Drumstick, HandCoins, ImageDown, Leaf, Link2, LoaderCircle, Minus, Plus,
  QrCode, ReceiptText, ScanText, Share2, Split as SplitIcon, Trash, UserPlus, Users, UsersRound,
} from 'lucide-react';
import { CATEGORIES } from '../lib/constants.js';
import { money, copyText, downloadBlob } from '../lib/format.js';
import { formatAD, formatBS } from '../lib/nepaliDate.js';
import { deleteGroup, forgetFriend, loadFriends, loadGroups, rememberFriends, saveGroup } from '../lib/profile.js';
import {
  autoWeight, clearItemOverrides, clearMemberOverrides, computeSplit, decodeSplit, encodeSplit, makeItem, makeMember,
  newSplitForExpense, outstanding, parseLineItemsFromText, sharePayload, splitFromPayload, TAG_LABELS, TAGS, weightOf,
} from '../lib/splitter.js';
import { drawSplitSummary } from '../lib/splitImage.js';
import { useStore } from '../store.jsx';
import { QrBox, usePaymentQr } from '../components/PaymentQr.jsx';
import { useToast } from '../components/Toast.jsx';
import { Button, Card, EmptyState, Field, PageHeader, Segmented } from '../components/ui.jsx';

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

function ItemsEditor({ split, update, onReadPhoto, reading }) {
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState('');
  const setItem = (id, patch) => {
    let next = { ...split, items: split.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) };
    if (patch.tag) next = clearItemOverrides(next, id);
    update(next);
  };
  const removeItem = (id) => update({ ...clearItemOverrides(split, id), items: split.items.filter((it) => it.id !== id) });

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-bold">Items ({split.items.length})</h2>
        {onReadPhoto && <Button size="sm" icon={reading ? LoaderCircle : ScanText} className={reading ? '[&_svg]:animate-spin' : ''} disabled={reading} onClick={onReadPhoto}>Read items from photo</Button>}
        <Button size="sm" icon={ClipboardPaste} onClick={() => setPaste((v) => !v)}>Paste bill text</Button>
      </div>
      {paste && (
        <div className="mb-3 space-y-2 rounded-lg bg-slate-50 p-3">
          <textarea rows={5} className="input font-mono text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder={'Chicken Momo 2 250 500\nTuborg 2 x 450 900\nVeg Chowmein 180'} aria-label="Bill text" />
          <Button size="sm" variant="dark" onClick={() => { const found = parseLineItemsFromText(text); update({ ...split, items: [...split.items, ...found] }); setPaste(false); setText(''); }}>Add these items</Button>
        </div>
      )}
      <div className="space-y-2">
        {split.items.map((it) => (
          <div key={it.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-[minmax(0,1fr)_64px_100px_120px_auto]">
            <input className="input py-1.5" value={it.name} onChange={(e) => setItem(it.id, { name: e.target.value })} aria-label="Item name" placeholder="Item" />
            <button type="button" onClick={() => removeItem(it.id)} className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-brand sm:order-last" aria-label={`Delete ${it.name}`}><Trash className="size-4" /></button>
            <input className="input num py-1.5" inputMode="numeric" value={it.qty} onChange={(e) => { const q = Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1); setItem(it.id, { qty: q, price: Math.round((it.amount / q) * 100) / 100 }); }} aria-label="Quantity" title="Quantity" />
            <input className="input num py-1.5" inputMode="decimal" value={it.amount} onChange={(e) => { const a = e.target.value.replace(/[^\d.]/g, ''); setItem(it.id, { amount: a, price: Math.round(((Number(a) || 0) / it.qty) * 100) / 100 }); }} aria-label="Amount" title="Line amount" />
            <select className="input py-1.5" value={it.tag} onChange={(e) => setItem(it.id, { tag: e.target.value })} aria-label="Type">
              {TAGS.map((t) => <option key={t} value={t}>{TAG_LABELS[t]}</option>)}
            </select>
          </div>
        ))}
      </div>
      <Button size="sm" icon={Plus} className="mt-3" onClick={() => update({ ...split, items: [...split.items, makeItem({ name: '', amount: 0 })] })}>Add item</Button>
      {split.mode === 'equal'
        ? <p className="mt-2 text-sm text-slate-500">“Split equally” is on, so items aren’t used for shares. They still appear in the bill’s record.</p>
        : !split.items.length && <p className="mt-2 text-sm text-slate-500">No items yet: with none, the bill is split equally between everyone in the split.</p>}
    </Card>
  );
}

function MembersEditor({ split, update }) {
  const [name, setName] = useState('');
  const [friends, setFriends] = useState(loadFriends);
  const [groups, setGroups] = useState(loadGroups);
  const inSplit = new Set(split.members.map((m) => m.name.toLowerCase()));
  const add = (list) => update({ ...split, members: [...split.members, ...list.filter((f) => f.name && !inSplit.has(f.name.toLowerCase())).map((f) => makeMember(f))] });
  const setMember = (id, patch) => update({ ...clearMemberOverrides(split, id), members: split.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  const remove = (id) => {
    const { [id]: _p, ...paid } = split.paid || {};
    update({ ...clearMemberOverrides(split, id), members: split.members.filter((m) => m.id !== id), paid });
  };

  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2 font-bold"><Users className="size-4" />People ({split.members.length})</h2>
      <ul className="space-y-2">
        {split.members.map((m) => (
          <li key={m.id} className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 ${m.out ? 'border-dashed border-slate-300 bg-slate-50 opacity-70' : 'border-slate-200'}`}>
            <button
              type="button"
              aria-pressed={!m.out}
              title={m.out ? 'Left out of this split: tap to include' : 'In this split: tap to leave out'}
              onClick={() => update({ ...split, members: split.members.map((x) => (x.id === m.id ? { ...x, out: !x.out } : x)) })}
              className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold ring-1 ring-inset ${m.out ? 'bg-white text-slate-500 ring-slate-300' : 'bg-emerald-50 text-emerald-800 ring-emerald-300'}`}
            >
              <CircleCheck className="size-4" />{m.out ? 'Left out' : 'In split'}
            </button>
            <input className="input min-w-[120px] flex-1 py-1.5" value={m.name} onChange={(e) => update({ ...split, members: split.members.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)) })} aria-label="Name" />
            {m.isPayer && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-bold text-white">Paid the bill</span>}
            <Segmented value={m.diet} onChange={(diet) => setMember(m.id, { diet })} options={[{ value: 'veg', label: 'Veg' }, { value: 'non-veg', label: 'Non-veg' }]} />
            <button type="button" aria-pressed={m.alcohol} onClick={() => setMember(m.id, { alcohol: !m.alcohol })} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ring-1 ring-inset ${m.alcohol ? 'bg-amber-100 text-amber-900 ring-amber-300' : 'bg-white text-slate-500 ring-slate-300'}`} title="Drinks alcohol">
              <Beer className="size-4" />{m.alcohol ? 'Drinks' : 'No drinks'}
            </button>
            {!m.isPayer && <button type="button" onClick={() => remove(m.id)} className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-brand" aria-label={`Remove ${m.name}`}><Trash className="size-4" /></button>}
          </li>
        ))}
      </ul>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { add([{ name: name.trim(), diet: 'non-veg', alcohol: false }]); setName(''); } }}>
        <input className="input py-2" value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a person" aria-label="New person's name" />
        <Button type="submit" variant="dark" icon={UserPlus}>Add</Button>
      </form>
      {(friends.some((f) => !inSplit.has(f.name.toLowerCase())) || groups.length > 0) && (
        <div className="mt-3 space-y-2 text-sm">
          {groups.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Groups</span>
              {groups.map((g) => (
                <span key={g.name} className="inline-flex items-center rounded-full bg-navy/10 text-navy">
                  <button type="button" className="py-1 pl-3 pr-1 font-semibold" onClick={() => add(g.members)}>{g.name} ({g.members.length})</button>
                  <button type="button" className="px-2 py-1 text-navy/60 hover:text-brand" aria-label={`Delete group ${g.name}`} onClick={() => { deleteGroup(g.name); setGroups(loadGroups()); }}>×</button>
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Friends</span>
            {friends.filter((f) => !inSplit.has(f.name.toLowerCase())).map((f) => (
              <span key={f.name} className="inline-flex items-center rounded-full bg-slate-100 text-slate-800">
                <button type="button" className="py-1 pl-3 pr-1 font-semibold" onClick={() => add([f])}>+ {f.name}{f.diet === 'veg' ? ' 🥗' : ''}{f.alcohol ? ' 🍺' : ''}</button>
                <button type="button" className="px-2 py-1 text-slate-400 hover:text-brand" aria-label={`Forget ${f.name}`} onClick={() => { forgetFriend(f.name); setFriends(loadFriends()); }}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}
      {split.members.length > 1 && (
        <button type="button" className="mt-3 text-sm font-semibold text-navy underline" onClick={() => { const n = window.prompt('Name this group (e.g. Office lunch)'); if (n?.trim()) { saveGroup(n, split.members); setGroups(loadGroups()); } }}>
          Save these people as a group
        </button>
      )}
    </Card>
  );
}

/** Item × person ticks. Auto-ticks from diet/drinks; any tick can be changed. "Units" mode counts 1x/2x. */
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
    <Card className="p-4">
      <h2 className="mb-1 font-bold">Who had what</h2>
      <p className="mb-3 text-xs text-slate-500">Ticked automatically from each person’s diet and drinks. Tap to change; switch an item to “By units” when someone had 2 of them.</p>
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
    </Card>
  );
}

function Shares({ split, result, update, region, payer }) {
  const [open, setOpen] = useState('');
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-bold">Shares</h2>
        <Segmented value={split.mode === 'equal' ? 'equal' : 'items'} onChange={(mode) => update({ ...split, mode })} options={[{ value: 'items', label: 'By items' }, { value: 'equal', label: 'Split equally' }]} />
      </div>
      {split.mode === 'equal' ? (
        <p className="mb-3 text-sm text-slate-600">
          Bill {money(result.total, region)} ÷ {result.members.filter((r) => !r.out).length} {result.members.filter((r) => !r.out).length === 1 ? 'person' : 'people'} in the split.
        </p>
      ) : (
        <>
          <div className="mb-2"><Segmented value={split.taxMode || 'proportional'} onChange={(taxMode) => update({ ...split, taxMode })} options={[{ value: 'proportional', label: 'Proportional tax' }, { value: 'equal', label: 'Equal tax' }]} /></div>
          <p className="mb-3 text-sm text-slate-600">
            Items {money(result.itemsSubtotal, region)} · bill {money(result.total, region)}
            {Math.abs(result.extra) >= 0.01 && <> · {result.extra > 0 ? 'VAT / service charge' : 'discount'} <b>{result.extra > 0 ? '+' : '−'}{money(Math.abs(result.extra), region)}</b> ({(result.extraPct * 100).toFixed(1)}%), {split.taxMode === 'equal' ? 'split equally' : 'shared in proportion to what each person had'}</>}
          </p>
        </>
      )}
      {result.unassigned > 0 && <p className="mb-3 rounded-lg bg-amber-50 p-2.5 text-sm font-semibold text-amber-900 ring-1 ring-inset ring-amber-200">{money(result.unassigned, region)} isn’t assigned to anyone yet. Tick someone for the highlighted items.</p>}
      <ul className="divide-y divide-slate-100">
        {result.members.map((r) => (
          <li key={r.id} className="py-2">
            <div className="flex items-center gap-3">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === r.id ? '' : r.id)} aria-expanded={open === r.id}>
                <span className="font-semibold">{r.name || 'Person'}</span>{r.isPayer && <span className="ml-2 text-xs text-slate-500">(you paid)</span>}
                {split.mode !== 'equal' && !r.out && <span className="block text-xs text-slate-500">items {money(r.subtotal, region)}{Math.abs(r.extra) >= 0.01 ? ` ${r.extra > 0 ? '+' : '−'} ${money(Math.abs(r.extra), region)} ${r.extra > 0 ? 'VAT/SC' : 'discount'}` : ''}</span>}
              </button>
              <span className="num text-lg font-extrabold">{money(r.share, region)}</span>
              {r.out && <span className="text-xs font-semibold text-slate-500">Left out</span>}
              {!r.isPayer && !r.out && (
                <button type="button" aria-pressed={Boolean(split.paid?.[r.id])} onClick={() => update({ ...split, paid: { ...split.paid, [r.id]: !split.paid?.[r.id] } })} className={`inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-bold ring-1 ring-inset ${split.paid?.[r.id] ? 'bg-emerald-50 text-emerald-800 ring-emerald-300' : 'bg-white text-slate-600 ring-slate-300'}`}>
                  <CircleCheck className="size-3.5" />{split.paid?.[r.id] ? 'Paid' : 'Mark paid'}
                </button>
              )}
            </div>
            {open === r.id && (
              <ul className="mt-2 space-y-0.5 pl-3 text-sm text-slate-600">
                {r.lines.map((l) => <li key={l.itemId} className="flex justify-between gap-2"><span>{l.name}{l.of > 1 || l.weight > 1 ? ` (${l.weight}/${l.of})` : ''}</span><span className="num">{money(l.amount, region)}</span></li>)}
                {!r.lines.length && <li>No items</li>}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-sm">
        <div><div className="text-xs font-bold uppercase text-slate-500">My share</div><div className="num font-extrabold">{money(result.myShare, region)}</div></div>
        <div><div className="text-xs font-bold uppercase text-slate-500">To collect</div><div className="num font-extrabold">{money(result.recoverable, region)}</div></div>
        <div><div className="text-xs font-bold uppercase text-slate-500">Still owed</div><div className="num font-extrabold text-amber-800">{money(outstanding(split, result), region)}</div></div>
      </div>
      {payer && <p className="mt-2 text-xs text-slate-500">Friends pay {payer.payerName || 'you'} via {payer.label || 'your QR'}.</p>}
    </Card>
  );
}

function ShareBar({ split, result, payerInfo }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const payer = { name: payerInfo?.payerName || result.members.find((m) => m.isPayer)?.name || '', qrText: payerInfo?.text || '', qrImage: payerInfo?.image || '', qrLabel: payerInfo?.label || '' };
  const fileName = `split_${(split.title || 'bill').replace(/[^\wऀ-ॿ]+/g, '_').slice(0, 30)}_${split.dateAD || ''}.png`;

  async function image() {
    setBusy('image');
    try { downloadBlob(await drawSplitSummary({ split, result, payer }), fileName); toast('Summary image downloaded.'); } catch (e) { toast(`Couldn’t draw the image: ${e.message}`, 'error'); } finally { setBusy(''); }
  }
  async function shareImage() {
    setBusy('share');
    try {
      const file = new File([await drawSplitSummary({ split, result, payer })], fileName, { type: 'image/png' });
      await navigator.share({ files: [file], title: `${split.title} split` });
    } catch (e) { if (e.name !== 'AbortError') toast('Sharing isn’t available here. Download the image instead.', 'error'); } finally { setBusy(''); }
  }
  async function link() {
    setBusy('link');
    try {
      const token = await encodeSplit(sharePayload(split, { payerName: payer.name, qrText: payer.qrText, qrLabel: payer.qrLabel }));
      const url = `${window.location.origin}${window.location.pathname}#/split/${token}`;
      if (await copyText(url)) toast(`Split link copied (${url.length} characters). Paste it in your group chat.`);
    } catch (e) { toast(`Couldn’t make the link: ${e.message}`, 'error'); } finally { setBusy(''); }
  }
  const canShareFiles = typeof navigator !== 'undefined' && navigator.canShare?.({ files: [new File([''], 'x.png', { type: 'image/png' })] });

  return (
    <Card className="p-4">
      <h2 className="mb-3 font-bold">Send it to the group</h2>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={busy === 'image' ? LoaderCircle : ImageDown} disabled={!!busy} onClick={image}>Download Split Summary Image (PNG)</Button>
        {canShareFiles && <Button icon={Share2} disabled={!!busy} onClick={shareImage}>Share image</Button>}
        <Button variant="dark" icon={busy === 'link' ? LoaderCircle : Link2} disabled={!!busy} onClick={link}>Copy Interactive Split Link</Button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        The link holds the whole split inside it (items, names, shares{payer.qrText ? ' and your payment QR' : ''}). Friends open it read-only on their own phones; nothing is uploaded.
        {payer.qrImage && !payer.qrText ? ' Your uploaded QR couldn’t be read, so only the image includes it.' : ''}
      </p>
    </Card>
  );
}

export function SplitEditor({ billId }) {
  const { expenses, profile, saveExpense, settings } = useStore();
  const toast = useToast();
  const payerInfo = usePaymentQr();
  const expense = expenses.find((e) => e.id === billId);
  const [split, setSplit] = useState(() => (expense ? { ...newSplitForExpense(expense, profile), ...(expense.split || {}) } : null));
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

  async function readPhoto() {
    setReading(true);
    try {
      const [{ prepareForOcr }, { extractBill }] = await Promise.all([import('../lib/image.js'), import('../lib/ocr/index.js')]);
      const out = await extractBill(await prepareForOcr(expense.receiptImage), settings, { region: profile.region });
      const found = out.fields.lineItems || [];
      if (!found.length) toast('No item rows found on the photo. Add them by hand or paste the text.', 'error');
      else { update({ ...split, items: [...split.items, ...found] }); toast(`Added ${found.length} items. Check them against the bill.`); }
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

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Split: ${expense.merchantName || 'Bill'}`}
        subtitle={<>{formatAD(expense.billDateAD)}{expense.billDateBS ? ` · ${formatBS(expense.billDateBS)}` : ''} · full bill <b className="num">{money(total, profile.region)}</b> stays in your ledger for the IRD draw · saved automatically</>}
        actions={<>{expense.split && <Button variant="ghost" icon={Trash} onClick={removeSplit}>Remove split</Button>}<a href="#/split" className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">All splits</a></>}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-4">
          <MembersEditor split={split} update={update} />
          <ItemsEditor split={split} update={update} onReadPhoto={expense.receiptImage ? readPhoto : null} reading={reading} />
          <Matrix split={split} update={update} />
        </div>
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Shares split={live} result={result} update={update} region={profile.region} payer={payerInfo} />
          <ShareBar split={live} result={result} payerInfo={payerInfo} />
          {payerInfo
            ? <div className="flex justify-center"><QrBox text={payerInfo.text} image={payerInfo.image} label={payerInfo.label} size={160} /></div>
            : <a href="#/settings" className="block rounded-lg bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-200"><HandCoins className="mr-1 inline size-4" />Add your payment QR in Settings so it appears on the summary and link.</a>}
        </div>
      </div>
    </div>
  );
}

/* ---------------- shared, read-only ---------------- */

export function SplitShare({ token }) {
  const [state, setState] = useState({ loading: true });
  const [me, setMe] = useState('');
  useEffect(() => {
    let live = true;
    decodeSplit(token)
      .then((p) => live && setState({ ...splitFromPayload(p), loading: false }))
      .catch(() => live && setState({ error: 'This split link is incomplete or damaged. Ask for it to be sent again.', loading: false }));
    return () => { live = false; };
  }, [token]);

  if (state.loading) return <div className="py-20 text-center text-slate-500">Opening the split…</div>;
  if (state.error) return <Card><EmptyState icon={SplitIcon} title="Can’t open this split">{state.error}</EmptyState></Card>;

  const { split, payer } = state;
  const result = computeSplit(split);
  const mine = result.members.find((m) => m.id === me);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={split.title} subtitle={<>{formatAD(split.dateAD)}{split.dateBS ? ` · ${formatBS(split.dateBS)} BS` : ''} · bill {money(result.total)} · split by {payer.name || 'a friend'} with BillKhata</>} />
      <Card className="p-4">
        <Field label="Who are you?" htmlFor="who">
          <select id="who" className="input" value={me} onChange={(e) => setMe(e.target.value)}>
            <option value="">Choose your name</option>
            {result.members.filter((m) => !m.isPayer && !m.out).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        {mine && (
          <div className="mt-4 rounded-xl bg-slate-900 p-5 text-center text-white">
            <div className="text-sm opacity-80">{mine.name}, you owe {payer.name || 'the payer'}</div>
            <div className="num mt-1 text-4xl font-extrabold">{money(mine.share)}</div>
          </div>
        )}
        {(payer.qrText) ? (
          <div className="mt-4 flex flex-col items-center gap-1">
            <QrBox text={payer.qrText} label={payer.qrLabel || `Pay ${payer.name}`} size={220} />
            <p className="text-xs text-slate-500">{/^eSewa/.test(payer.qrLabel) ? 'Scan with the eSewa app.' : 'Scan with your banking or wallet app.'}</p>
          </div>
        ) : <p className="mt-3 text-sm text-slate-600">Ask {payer.name || 'the payer'} for their payment QR.</p>}
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 font-bold">Everyone’s share</h2>
        <ul className="divide-y divide-slate-100">
          {result.members.filter((r) => !r.out).map((r) => (
            <li key={r.id} className={`py-2.5 ${r.id === me ? 'rounded-lg bg-amber-50 px-2' : ''}`}>
              <div className="flex justify-between gap-3 font-semibold"><span>{r.name}{r.isPayer ? ' (paid the bill)' : ''}</span><span className="num">{money(r.share)}</span></div>
              <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
                {r.lines.map((l) => <li key={l.itemId} className="flex justify-between gap-2"><span><TagDot tag={l.tag} />{l.name}{l.of > 1 || l.weight > 1 ? ` (${l.weight}/${l.of})` : ''}</span><span className="num">{money(l.amount)}</span></li>)}
                {r.lines.length > 0 && Math.abs(r.extra) >= 0.01 && <li className="flex justify-between gap-2 text-slate-500"><span>{r.extra > 0 ? 'VAT / service charge' : 'Discount'}</span><span className="num">{r.extra > 0 ? '+' : '−'}{money(Math.abs(r.extra))}</span></li>}
              </ul>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500">
          {split.mode === 'equal'
            ? `Split equally between ${result.members.filter((r) => !r.out).length} people.`
            : `Items ${money(result.itemsSubtotal)}${Math.abs(result.extra) >= 0.01 ? ` · ${result.extra > 0 ? 'VAT/service charge' : 'discount'} ${(result.extraPct * 100).toFixed(1)}% ${split.taxMode === 'equal' ? 'split equally' : 'shared in proportion'}` : ''}.`}
          This page is read-only; everything comes from the link, nothing is stored.
        </p>
      </Card>
    </div>
  );
}

function TagDot({ tag }) {
  const color = { veg: 'bg-emerald-600', 'non-veg': 'bg-red-600', alcohol: 'bg-amber-500', shared: 'bg-slate-400' }[tag] || 'bg-slate-400';
  return <span className={`mr-1.5 inline-block size-2 rounded-full align-middle ${color}`} aria-label={TAG_LABELS[tag]} />;
}

