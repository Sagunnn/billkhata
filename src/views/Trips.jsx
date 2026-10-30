// Trip Khata: trips list (#/trips) and one trip (#/trip/<id>).
// Multi-payer expenses (scanned bills and no-bill cash), per-item veg/non-veg/drink splits,
// and a settlement with as few transfers as possible. Everything stays on this device.
import { useMemo, useState } from 'react';
import {
  ArrowRight, Beer, Camera, CircleCheck, Drumstick, FileDown, ImagePlus, Leaf, ListPlus, LoaderCircle, Luggage,
  NotebookPen, Pencil, Plus, QrCode, Receipt, ScanText, Trash, UserPlus, Users, UsersRound,
} from 'lucide-react';
import { PAYMENT, PAYMENT_METHODS, REGIONS } from '../lib/constants.js';
import { newId } from '../lib/db.js';
import { downloadBlob, money } from '../lib/format.js';
import { getIrdStatus } from '../lib/ird.js';
import { adToBs, formatAD, formatBS, todayAD } from '../lib/nepaliDate.js';
import { decodeQrFromImage, qrKind } from '../lib/qr.js';
import {
  calculateTripSettlement, classifyTripItem, entryShares, getDefaultAssignedMembers, makeEntry, makeTrip, makeTripItem,
  makeTripMember, TRIP_CATEGORIES, TRIP_CATEGORY_LABELS, transferKey,
} from '../lib/trips.js';
import { useStore } from '../store.jsx';
import { QrBox, usePaymentQr } from '../components/PaymentQr.jsx';
import { useToast } from '../components/Toast.jsx';
import { Button, Card, CopyButton, EmptyState, Field, Modal, PageHeader, Segmented, StatusBadge } from '../components/ui.jsx';

const CAT_STYLE = {
  veg: ['bg-emerald-50 text-emerald-800 ring-emerald-200', Leaf],
  'non-veg': ['bg-red-50 text-red-800 ring-red-200', Drumstick],
  drink: ['bg-amber-50 text-amber-900 ring-amber-200', Beer],
  shared: ['bg-slate-100 text-slate-700 ring-slate-300', UsersRound],
};
function CatChip({ cat }) {
  const [cls, Icon] = CAT_STYLE[cat] || CAT_STYLE.shared;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${cls}`}><Icon className="size-3" />{TRIP_CATEGORY_LABELS[cat]}</span>;
}

/* ---------------- list ---------------- */

export function TripsHub() {
  const { trips, profile, saveTrip } = useStore();
  const [name, setName] = useState('');
  const sorted = [...trips].sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));

  async function create(e) {
    e.preventDefault();
    const t = await saveTrip(makeTrip({ name: name || 'New trip', profile }));
    window.location.hash = `#/trip/${encodeURIComponent(t.id)}`;
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Trip Khata" subtitle="Group trips with many payers: scanned bills and cash with no bill, split by who ate and drank what, settled in as few payments as possible." />
      <Card className="p-4">
        <form onSubmit={create} className="flex flex-wrap gap-2">
          <input className="input min-w-[200px] flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Trip name, e.g. Nagarkot Weekend" aria-label="Trip name" />
          <Button type="submit" variant="primary" icon={Plus}>Start a trip</Button>
        </form>
      </Card>
      <Card>
        <h2 className="border-b border-slate-200 px-4 py-3 font-bold">Your trips</h2>
        {sorted.length ? (
          <ul className="divide-y divide-slate-100">
            {sorted.map((t) => {
              const s = calculateTripSettlement(t);
              const me = s.members.find((m) => m.isMe);
              return (
                <li key={t.id}>
                  <a href={`#/trip/${encodeURIComponent(t.id)}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <Luggage className="size-5 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{t.name}{t.status === 'settled' && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-800">Settled</span>}</div>
                      <div className="text-xs text-slate-500">{t.members.length} people · {t.entries.length} expenses · {money(s.total, profile.region)}</div>
                    </div>
                    {me && (
                      <span className={`text-sm font-semibold ${me.netBalance > 0.5 ? 'text-emerald-700' : me.netBalance < -0.5 ? 'text-red-700' : 'text-slate-500'}`}>
                        {me.netBalance > 0.5 ? `You get ${money(me.netBalance, profile.region)}` : me.netBalance < -0.5 ? `You owe ${money(-me.netBalance, profile.region)}` : 'You’re even'}
                      </span>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        ) : <EmptyState icon={Luggage} title="No trips yet">Start one above, add your friends, then log every bill and cash payment as you go.</EmptyState>}
      </Card>
    </div>
  );
}

/* ---------------- members ---------------- */

function MembersCard({ trip, update, myQr }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [qrFor, setQrFor] = useState('');
  const used = new Set(trip.entries.map((e) => e.paidByMemberId));
  const setMember = (id, patch) => update({ ...trip, members: trip.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) });

  async function qrFromImage(id, file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const text = await decodeQrFromImage(url);
      if (!text) toast('Couldn’t read a QR in that image. Try a tighter screenshot of just the QR.', 'error');
      else { setMember(id, { paymentQrRaw: text }); toast(qrKind(text) === 'emv-invalid' ? 'QR read, but its checksum is wrong: it may be misread.' : 'Payment QR saved for this person.', qrKind(text) === 'emv-invalid' ? 'error' : 'success'); }
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-1 flex items-center gap-2 font-bold"><Users className="size-4" />People ({trip.members.length})</h2>
      <p className="mb-3 text-xs text-slate-500">Diet and drinks set who shares each item by default. New expenses use the current list.</p>
      <ul className="space-y-2">
        {trip.members.map((m) => (
          <li key={m.id} className="rounded-lg border border-slate-200 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <input className="input min-w-[120px] flex-1 py-1.5" value={m.name} onChange={(e) => setMember(m.id, { name: e.target.value })} aria-label="Name" />
              {m.isMe && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-bold text-white">You</span>}
              <Segmented value={m.isVeg ? 'veg' : 'non-veg'} onChange={(v) => setMember(m.id, { isVeg: v === 'veg' })} options={[{ value: 'veg', label: 'Veg' }, { value: 'non-veg', label: 'Non-veg' }]} />
              <button type="button" aria-pressed={m.drinks} onClick={() => setMember(m.id, { drinks: !m.drinks })} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ring-1 ring-inset ${m.drinks ? 'bg-amber-100 text-amber-900 ring-amber-300' : 'bg-white text-slate-500 ring-slate-300'}`}>
                <Beer className="size-4" />{m.drinks ? 'Drinks' : 'No drinks'}
              </button>
              <button type="button" onClick={() => setQrFor(qrFor === m.id ? '' : m.id)} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ring-1 ring-inset ${(m.isMe ? myQr : m.paymentQrRaw) ? 'bg-emerald-50 text-emerald-800 ring-emerald-300' : 'bg-white text-slate-500 ring-slate-300'}`} aria-expanded={qrFor === m.id}>
                <QrCode className="size-4" />QR
              </button>
              {!m.isMe && (
                <button type="button" disabled={used.has(m.id)} title={used.has(m.id) ? 'They paid for something; change that first' : `Remove ${m.name}`} onClick={() => update({ ...trip, members: trip.members.filter((x) => x.id !== m.id), entries: trip.entries.map((e) => ({ ...e, items: e.items.map((it) => ({ ...it, assignedMemberIds: it.assignedMemberIds.filter((id) => id !== m.id) })) })) })} className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-brand disabled:opacity-30" aria-label={`Remove ${m.name}`}>
                  <Trash className="size-4" />
                </button>
              )}
            </div>
            {qrFor === m.id && (
              <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm">
                {m.isMe ? (
                  myQr ? <QrBox text={myQr.image ? '' : myQr.text} image={myQr.image} label={myQr.label} size={150} /> : <a href="#/settings" className="font-semibold text-navy underline">Set up your payment QR in Settings</a>
                ) : (
                  <div className="space-y-2">
                    <p className="text-slate-600">So people who owe {m.name || 'them'} can scan it: upload a screenshot of their QR, or paste its text.</p>
                    <div className="flex flex-wrap gap-2">
                      <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 font-semibold hover:bg-slate-50">
                        <ImagePlus className="size-4" />Upload QR image
                        <input type="file" accept="image/*" className="sr-only" onChange={(e) => { qrFromImage(m.id, e.target.files?.[0]); e.target.value = ''; }} />
                      </label>
                      {m.paymentQrRaw && <Button size="md" variant="danger" onClick={() => setMember(m.id, { paymentQrRaw: '' })}>Remove</Button>}
                    </div>
                    <textarea rows={2} className="input font-mono text-xs" value={m.paymentQrRaw} onChange={(e) => setMember(m.id, { paymentQrRaw: e.target.value.trim() })} placeholder="000201… (NepalQR text) or eSewa QR text" aria-label="Payment QR text" />
                    {m.paymentQrRaw && <QrBox text={m.paymentQrRaw} label={qrKind(m.paymentQrRaw) === 'emv-invalid' ? 'Checksum wrong: may be misread' : m.name} size={150} />}
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { update({ ...trip, members: [...trip.members, makeTripMember({ name })] }); setName(''); } }}>
        <input className="input py-2" value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a person" aria-label="New person's name" />
        <Button type="submit" variant="dark" icon={UserPlus}>Add</Button>
      </form>
    </Card>
  );
}

/* ---------------- entry editor ---------------- */

function MemberPills({ members, ids, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {members.map((m) => {
        const on = ids.includes(m.id);
        return (
          <button key={m.id} type="button" aria-pressed={on} onClick={() => onChange(on ? ids.filter((x) => x !== m.id) : [...ids, m.id])} className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${on ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-500 ring-slate-300'}`}>
            {on ? '✓ ' : ''}{m.name || 'Person'}
          </button>
        );
      })}
    </div>
  );
}

function ItemRow({ item, members, onChange, onRemove }) {
  const setCat = (category) => onChange({ ...item, category, vegOnly: false, assignedMemberIds: getDefaultAssignedMembers(category, members) });
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-2.5">
      <div className="grid grid-cols-[minmax(0,1fr)_96px_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_110px_120px_auto]">
        <input className="input py-1.5" value={item.name} onChange={(e) => { const name = e.target.value; onChange({ ...item, name }); }} onBlur={(e) => { const c = classifyTripItem(e.target.value); if (!item.touchedCategory && c !== item.category) setCat(c); }} placeholder="Item" aria-label="Item name" />
        <input className="input num py-1.5" inputMode="decimal" value={item.amount} onChange={(e) => onChange({ ...item, amount: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" aria-label="Amount" />
        <select className="input col-span-1 py-1.5 sm:col-auto" value={item.category} onChange={(e) => onChange({ ...item, touchedCategory: true, category: e.target.value, vegOnly: false, assignedMemberIds: getDefaultAssignedMembers(e.target.value, members) })} aria-label="Type">
          {TRIP_CATEGORIES.map((c) => <option key={c} value={c}>{TRIP_CATEGORY_LABELS[c]}</option>)}
        </select>
        {onRemove && <button type="button" onClick={onRemove} className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-brand" aria-label="Delete item"><Trash className="size-4" /></button>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <MemberPills members={members} ids={item.assignedMemberIds} onChange={(ids) => onChange({ ...item, assignedMemberIds: ids })} />
        {item.category === 'veg' && members.some((m) => m.isVeg) && (
          <button type="button" aria-pressed={Boolean(item.vegOnly)} onClick={() => { const vegOnly = !item.vegOnly; onChange({ ...item, vegOnly, assignedMemberIds: getDefaultAssignedMembers('veg', members, { vegOnly }) }); }} className={`ml-auto rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${item.vegOnly ? 'bg-emerald-700 text-white ring-emerald-700' : 'text-emerald-800 ring-emerald-300'}`}>
            Veg members only
          </button>
        )}
      </div>
      {!item.assignedMemberIds.length && <p className="text-xs font-semibold text-amber-900">Nobody ticked: it will be shared by everyone.</p>}
    </div>
  );
}

function EntryModal({ trip, entry, onClose, onSave }) {
  const { settings, profile, expenses } = useStore();
  const toast = useToast();
  const members = trip.members;
  const me = members.find((m) => m.isMe) || members[0];
  const linked = entry?.linkedExpenseId ? expenses.find((x) => x.id === entry.linkedExpenseId) : null;
  const [d, setD] = useState(() => {
    if (entry) return { ...entry, items: entry.items.map((it) => ({ ...it })), receiptImage: entry.receiptImage || linked?.receiptImage || '', paymentMethod: linked?.paymentMethod || entry.paymentMethod || PAYMENT.CASH, itemised: entry.hasBill || entry.items.length > 1 };
    return { title: '', paidByMemberId: me.id, dateAD: todayAD(), totalAmount: '', hasBill: false, items: [], receiptImage: '', sellerPan: '', invoiceNumber: '', vatAmount: '', paymentMethod: PAYMENT.CASH, itemised: false };
  });
  const [simple, setSimple] = useState(() => {
    const it = entry && entry.items.length === 1 ? entry.items[0] : null;
    return { category: it?.category || 'shared', touched: Boolean(it), ids: it?.assignedMemberIds || getDefaultAssignedMembers('shared', members) };
  });
  const [reading, setReading] = useState(false);
  const set = (patch) => setD((x) => ({ ...x, ...patch }));
  const itemsSum = d.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const total = Number(d.totalAmount) || 0;

  // Simple (one-line) expense: the category follows the title until changed by hand.
  const simpleCat = simple.touched ? simple.category : classifyTripItem(d.title);
  const simpleIds = simple.touched ? simple.ids : getDefaultAssignedMembers(simpleCat, members);

  async function readPhoto(file) {
    if (!file) return;
    setReading(true);
    try {
      const [{ compressImage, fileToDataUrl, prepareForOcr }, { extractBill }] = await Promise.all([import('../lib/image.js'), import('../lib/ocr/index.js')]);
      const src = await fileToDataUrl(file);
      const [stored, images] = await Promise.all([compressImage(src), prepareForOcr(src)]);
      set({ receiptImage: stored.dataUrl });
      const { fields } = await extractBill(images, settings, { region: profile.region });
      const items = (fields.lineItems || []).map((it) => makeTripItem({ name: it.name, amount: it.amount }, members));
      setD((x) => ({
        ...x,
        hasBill: true,
        itemised: true,
        title: x.title || fields.merchantName || '',
        sellerPan: fields.sellerPan || x.sellerPan,
        invoiceNumber: fields.invoiceNumber || x.invoiceNumber,
        dateAD: fields.billDateAD || x.dateAD,
        totalAmount: fields.totalAmount || x.totalAmount,
        vatAmount: fields.vatAmount || x.vatAmount,
        paymentMethod: fields.paymentMethod || x.paymentMethod,
        items: items.length ? items : x.items,
      }));
      toast(items.length ? `Read ${items.length} items. Check them against the bill.` : 'Read the bill, but no item rows. Add items by hand or keep it as one line.');
    } catch (e) {
      toast(`Couldn’t read the bill: ${e.message}`, 'error');
    } finally {
      setReading(false);
    }
  }

  function save() {
    if (!d.title.trim()) return toast('Give the expense a name.', 'error');
    if (!(total > 0)) return toast('Enter the amount paid.', 'error');
    const items = d.itemised
      ? d.items.filter((it) => it.name.trim() || Number(it.amount) > 0).map((it) => makeTripItem({ ...it, amount: Number(it.amount) || 0 }, members))
      : [makeTripItem({ name: d.title, amount: total, category: simpleCat, assignedMemberIds: simpleIds }, members)];
    if (!items.length) return toast('Add at least one item, or switch back to a single line.', 'error');
    const { itemised: _i, ...rest } = d;
    onSave(makeEntry({ ...rest, id: entry?.id, totalAmount: total, items, vatAmount: d.vatAmount === '' ? '' : Number(d.vatAmount) || 0 }, members));
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={entry ? 'Edit expense' : 'Add expense'}
      size="xl"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="dark" onClick={save}>Save expense</Button></>}
    >
      <div className="space-y-4">
        <Segmented value={d.hasBill ? 'bill' : 'cash'} onChange={(v) => set({ hasBill: v === 'bill', itemised: v === 'bill' ? true : d.itemised })} options={[{ value: 'cash', label: 'No bill (cash)' }, { value: 'bill', label: 'Has a bill' }]} />
        {d.hasBill && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3">
            {d.receiptImage ? <img src={d.receiptImage} alt="Bill" className="h-24 rounded border border-slate-200 object-contain" /> : <Receipt className="size-8 text-slate-300" />}
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800">
              {reading ? <LoaderCircle className="size-4 animate-spin" /> : <Camera className="size-4" />}{reading ? 'Reading…' : d.receiptImage ? 'Re-scan bill' : 'Scan / upload bill'}
              <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" disabled={reading} onChange={(e) => { readPhoto(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <span className="text-xs text-slate-500">Reads the shop, PAN, bill number, total and items.</span>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={d.hasBill ? 'Shop / bill' : 'What was it?'} htmlFor="te-title">
            <input id="te-title" className="input" value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder={d.hasBill ? 'e.g. Nagarkot Sekuwa Corner' : 'e.g. Taxi to Nagarkot, Petrol, Snacks'} />
          </Field>
          <Field label="Paid by" htmlFor="te-paid">
            <select id="te-paid" className="input" value={d.paidByMemberId} onChange={(e) => set({ paidByMemberId: e.target.value })}>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name || 'Person'}{m.isMe ? ' (you)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Amount paid (रु)" htmlFor="te-total">
            <input id="te-total" inputMode="decimal" className="input num text-lg font-semibold" value={d.totalAmount} onChange={(e) => set({ totalAmount: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" />
          </Field>
          <Field label="Date" htmlFor="te-date" hint={d.dateAD ? `${formatBS(adToBs(d.dateAD))} BS` : ''}>
            <input id="te-date" type="date" className="input" value={d.dateAD} onChange={(e) => set({ dateAD: e.target.value })} />
          </Field>
          {d.hasBill && (
            <>
              <Field label="Seller PAN / VAT" htmlFor="te-pan"><input id="te-pan" inputMode="numeric" className="input num" value={d.sellerPan || ''} onChange={(e) => set({ sellerPan: e.target.value.replace(/\D/g, '').slice(0, 9) })} /></Field>
              <Field label="Bill / invoice no." htmlFor="te-inv"><input id="te-inv" className="input" value={d.invoiceNumber || ''} onChange={(e) => set({ invoiceNumber: e.target.value })} /></Field>
              <Field label="VAT amount" htmlFor="te-vat" hint="Optional"><input id="te-vat" inputMode="decimal" className="input num" value={d.vatAmount ?? ''} onChange={(e) => set({ vatAmount: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
              <Field label="Paid with" htmlFor="te-pay">
                <select id="te-pay" className="input" value={d.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value })}>{PAYMENT_METHODS.map((p) => <option key={p}>{p}</option>)}</select>
              </Field>
            </>
          )}
        </div>
        {d.hasBill && d.paidByMemberId === me.id && <p className="rounded-lg bg-blue-50 p-2.5 text-xs text-blue-950">You paid this bill, so it’s also saved in your ledger for the IRD lucky draw. It isn’t counted as your spending there; your trip share is.</p>}
        {d.hasBill && d.paidByMemberId !== me.id && <p className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">{members.find((m) => m.id === d.paidByMemberId)?.name || 'They'} paid, so they hold the bill and can enter it in the IRD draw themselves.</p>}

        {d.itemised ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between"><h3 className="text-sm font-bold">Items</h3>{!d.hasBill && <button type="button" className="text-xs font-semibold text-navy underline" onClick={() => set({ itemised: false })}>Single line instead</button>}</div>
            {d.items.map((it, i) => (
              <ItemRow key={it.id} item={it} members={members} onChange={(next) => set({ items: d.items.map((x, k) => (k === i ? next : x)) })} onRemove={() => set({ items: d.items.filter((_, k) => k !== i) })} />
            ))}
            <Button size="sm" icon={ListPlus} onClick={() => set({ items: [...d.items, makeTripItem({ name: '', amount: '' }, members)] })}>Add item</Button>
            <p className="text-sm text-slate-600">
              Items {money(itemsSum)} · paid {money(total)}
              {total && Math.abs(total - itemsSum) >= 0.01 ? ` · ${total > itemsSum ? 'VAT / service charge' : 'discount'} ${money(Math.abs(total - itemsSum))} shared in proportion to each person’s items` : ''}
            </p>
          </div>
        ) : (
          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold">Shared by</span>
              <CatChip cat={simpleCat} />
              <select className="input w-auto py-1" value={simpleCat} onChange={(e) => setSimple({ category: e.target.value, touched: true, ids: getDefaultAssignedMembers(e.target.value, members) })} aria-label="Type">
                {TRIP_CATEGORIES.map((c) => <option key={c} value={c}>{TRIP_CATEGORY_LABELS[c]}</option>)}
              </select>
              <button type="button" className="ml-auto text-xs font-semibold text-navy underline" onClick={() => set({ itemised: true, items: d.items.length ? d.items : [makeTripItem({ name: d.title, amount: d.totalAmount, category: simpleCat, assignedMemberIds: simpleIds }, members)] })}>Split into items</button>
            </div>
            <MemberPills members={members} ids={simpleIds} onChange={(ids) => setSimple({ category: simpleCat, touched: true, ids })} />
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ---------------- settlement ---------------- */

function TransferQr({ to, amount, myQr }) {
  const qr = to.isMe ? myQr : to.paymentQrRaw ? { text: to.paymentQrRaw, image: '', label: to.name } : null;
  const fixed = Number(amount).toFixed(2);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-4 rounded-lg bg-slate-50 p-3">
      {qr ? <QrBox text={qr.image ? '' : qr.text} image={qr.image} label={qr.label} size={170} /> : <p className="text-sm text-slate-600">No QR saved for {to.name}. Add one under People.</p>}
      <div className="space-y-2 text-sm">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Pay {to.name}</div>
        <div className="num text-3xl font-extrabold">{money(amount)}</div>
        <CopyButton value={fixed} label={`Copy ${fixed}`} />
        <p className="text-xs text-slate-500">Scan, then type this amount in the app.</p>
      </div>
    </div>
  );
}

function Settlement({ trip, settlement, update, myQr, region }) {
  const [qrFor, setQrFor] = useState('');
  const byId = Object.fromEntries(trip.members.map((m) => [m.id, m]));
  return (
    <Card className="p-4">
      <h2 className="mb-3 font-bold">Settle up</h2>
      <ul className="divide-y divide-slate-100">
        {settlement.members.map((m) => (
          <li key={m.memberId} className="py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{m.name || 'Person'}{m.isMe ? ' (you)' : ''}</span>
              <span className={`num font-extrabold ${m.netBalance > 0.5 ? 'text-emerald-700' : m.netBalance < -0.5 ? 'text-red-700' : 'text-slate-500'}`}>
                {m.netBalance > 0.5 ? `gets ${money(m.netBalance, region)}` : m.netBalance < -0.5 ? `owes ${money(-m.netBalance, region)}` : 'even'}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              paid {money(m.totalPaid, region)} · used {money(m.totalConsumed, region)}
              {' '}(veg {money(m.breakdown.veg, region)} · non-veg {money(m.breakdown.nonVeg, region)} · drinks {money(m.breakdown.drink, region)} · shared {money(m.breakdown.shared, region)}{Math.abs(m.breakdown.tax) >= 0.01 ? ` · tax/SC ${money(m.breakdown.tax, region)}` : ''})
            </div>
          </li>
        ))}
      </ul>
      <h3 className="mb-2 mt-4 text-sm font-bold">Who pays whom ({settlement.transfers.length} payment{settlement.transfers.length === 1 ? '' : 's'})</h3>
      {settlement.transfers.length ? (
        <ul className="space-y-2">
          {settlement.transfers.map((t) => {
            const key = transferKey(t);
            const done = Boolean(trip.paidTransfers?.[key]);
            return (
              <li key={key} className={`rounded-lg border p-2.5 ${done ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200'}`}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <b>{byId[t.fromMemberId]?.name}</b><ArrowRight className="size-4 text-slate-400" /><b>{byId[t.toMemberId]?.name}</b>
                  <span className="num ml-auto text-base font-extrabold">{money(t.amount, region)}</span>
                  <button type="button" onClick={() => setQrFor(qrFor === key ? '' : key)} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-bold ring-1 ring-inset ring-slate-300" aria-expanded={qrFor === key}><QrCode className="size-3.5" />QR</button>
                  <button type="button" aria-pressed={done} onClick={() => update({ ...trip, paidTransfers: { ...trip.paidTransfers, [key]: done ? undefined : t.amount } })} className={`inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-bold ring-1 ring-inset ${done ? 'bg-emerald-50 text-emerald-800 ring-emerald-300' : 'text-slate-600 ring-slate-300'}`}>
                    <CircleCheck className="size-3.5" />{done ? 'Paid' : 'Mark paid'}
                  </button>
                </div>
                {qrFor === key && byId[t.toMemberId] && <TransferQr to={byId[t.toMemberId]} amount={t.amount} myQr={myQr} />}
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-slate-600">{trip.entries.length ? 'Everyone is even.' : 'Add expenses to see who owes whom.'}</p>}
      {settlement.warnings.length > 0 && <ul className="mt-3 space-y-1 text-xs text-amber-900">{settlement.warnings.map((w) => <li key={w}>• {w}</li>)}</ul>}
    </Card>
  );
}

function LedgerPicker({ trip, onPick, onClose }) {
  const { expenses, profile } = useStore();
  const linked = new Set(trip.entries.map((e) => e.linkedExpenseId).filter(Boolean));
  const list = expenses.filter((e) => !linked.has(e.id) && !e.tripId && !e.tripShareOf && Number(e.totalAmount) > 0).sort((a, b) => (b.billDateAD || '').localeCompare(a.billDateAD || '')).slice(0, 30);
  return (
    <Modal open onClose={onClose} title="Add a bill from your ledger" size="lg">
      {list.length ? (
        <ul className="divide-y divide-slate-100">
          {list.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1"><div className="truncate font-semibold">{e.merchantName}</div><div className="text-xs text-slate-500">{formatAD(e.billDateAD)} · {e.category}{e.lineItems?.length ? ` · ${e.lineItems.length} items` : ''}</div></div>
              <span className="num font-semibold">{money(e.totalAmount, profile.region)}</span>
              <Button size="sm" variant="dark" onClick={() => onPick(e)}>Add</Button>
            </li>
          ))}
        </ul>
      ) : <EmptyState icon={Receipt} title="No bills to add">Scan a bill first, or use “Add expense” to scan it straight into the trip.</EmptyState>}
    </Modal>
  );
}

/* ---------------- trip page ---------------- */

export function TripView({ tripId: id }) {
  const { trips, saveTrip, deleteTrip, expenses, saveExpense, removeExpense, profile } = useStore();
  const toast = useToast();
  const myQr = usePaymentQr();
  const trip = trips.find((t) => t.id === id);
  const [editing, setEditing] = useState(null); // null | 'new' | entry
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const settlement = useMemo(() => (trip ? calculateTripSettlement(trip) : null), [trip]);
  const region = profile.region || REGIONS.NEPAL;

  if (!trip) return <Card><EmptyState icon={Luggage} title="Trip not found" action={<a href="#/trips" className="font-semibold text-navy underline">All trips</a>} /></Card>;
  const me = trip.members.find((m) => m.isMe);
  const update = (next) => saveTrip(next);
  const byId = Object.fromEntries(trip.members.map((m) => [m.id, m]));

  /** Bills you paid also live in the ledger (for the IRD draw) but don't count as spending. */
  async function syncLedger(entry, previous) {
    const prevLinked = previous?.linkedExpenseId ? expenses.find((x) => x.id === previous.linkedExpenseId) : null;
    const mine = entry.hasBill && entry.paidByMemberId === me?.id;
    if (mine) {
      const base = prevLinked || { id: newId(), createdAt: new Date().toISOString(), createdByTrip: true, irdCoupon: '', notes: '' };
      const saved = await saveExpense({
        ...base,
        merchantName: entry.title,
        sellerPan: entry.sellerPan || '',
        invoiceNumber: entry.invoiceNumber || '',
        billDateAD: entry.dateAD,
        billDateBS: entry.dateBS,
        totalAmount: entry.totalAmount,
        vatAmount: entry.vatAmount === '' || entry.vatAmount == null ? null : entry.vatAmount,
        paymentMethod: entry.paymentMethod || PAYMENT.CASH,
        category: base.category || (entry.items.some((it) => it.category !== 'shared') ? 'Food & Dining' : 'Other'),
        isNepalBill: base.isNepalBill ?? region === REGIONS.NEPAL,
        receiptImage: entry.receiptImage || base.receiptImage || null,
        lineItems: entry.items.map((it) => ({ id: it.id, name: it.name, qty: 1, price: it.amount, amount: it.amount })),
        excludeFromSpend: true,
        tripId: trip.id,
      });
      const { receiptImage: _photo, paymentMethod, ...rest } = entry;
      return { ...rest, paymentMethod, linkedExpenseId: saved.id };
    }
    if (prevLinked) {
      // No longer your bill: one the trip created is removed (its photo stays with the trip
      // expense); one you added from your ledger goes back to being a normal bill.
      const { excludeFromSpend: _x, tripId: _t, ...plain } = prevLinked;
      if (prevLinked.createdByTrip) await removeExpense(prevLinked.id);
      else await saveExpense(plain);
    }
    return { ...entry, linkedExpenseId: '' };
  }

  async function saveEntry(entry) {
    const previous = trip.entries.find((e) => e.id === entry.id);
    const synced = await syncLedger(entry, previous);
    await update({ ...trip, entries: previous ? trip.entries.map((e) => (e.id === entry.id ? synced : e)) : [...trip.entries, synced] });
    setEditing(null);
    toast(previous ? 'Expense updated.' : 'Expense added.');
  }

  async function removeEntry(entry) {
    if (!window.confirm(`Remove “${entry.title}” from the trip?${entry.linkedExpenseId ? ' The bill stays in your ledger.' : ''}`)) return;
    const linked = entry.linkedExpenseId && expenses.find((x) => x.id === entry.linkedExpenseId);
    if (linked) { const { excludeFromSpend: _x, tripId: _t, ...plain } = linked; await saveExpense(plain); }
    await update({ ...trip, entries: trip.entries.filter((e) => e.id !== entry.id) });
  }

  async function addFromLedger(exp) {
    const members = trip.members;
    const items = (exp.lineItems || []).filter((it) => Number(it.amount) > 0).map((it) => makeTripItem({ name: it.name, amount: it.amount }, members));
    const entry = makeEntry({ title: exp.merchantName, paidByMemberId: me?.id, dateAD: exp.billDateAD || todayAD(), totalAmount: exp.totalAmount, hasBill: true, items, sellerPan: exp.sellerPan, invoiceNumber: exp.invoiceNumber, vatAmount: exp.vatAmount, paymentMethod: exp.paymentMethod, linkedExpenseId: exp.id }, members);
    await saveExpense({ ...exp, excludeFromSpend: true, tripId: trip.id });
    await update({ ...trip, entries: [...trip.entries, entry] });
    setPicking(false);
    toast(`Added ${exp.merchantName}. Check who had what.`);
  }

  async function logMyShare() {
    const mine = settlement.members.find((m) => m.isMe);
    if (!mine) return;
    const b = mine.breakdown;
    const dates = trip.entries.map((e) => e.dateAD).filter(Boolean).sort();
    const id = `trip-share-${trip.id}`;
    const existing = expenses.find((x) => x.id === id);
    await saveExpense({
      ...(existing || { id, createdAt: new Date().toISOString(), irdCoupon: '', receiptImage: null }),
      merchantName: `Trip: ${trip.name} (my share)`,
      totalAmount: mine.totalConsumed,
      billDateAD: dates.at(-1) || todayAD(),
      billDateBS: adToBs(dates.at(-1) || todayAD()) || '',
      category: 'Other',
      paymentMethod: PAYMENT.CASH,
      isNepalBill: false,
      sellerPan: '',
      invoiceNumber: '',
      vatAmount: null,
      notes: `Veg ${b.veg} · Non-veg ${b.nonVeg} · Drinks ${b.drink} · Shared ${b.shared} · Tax/SC ${b.tax}`,
      tripShareOf: trip.id,
    });
    toast(existing ? 'Your trip share in the ledger is updated.' : `Logged ${money(mine.totalConsumed, region)} as your trip share.`);
  }

  async function pdf() {
    setBusy(true);
    try {
      const { buildTripPdf, tripPdfFilename } = await import('../lib/pdf.js');
      const doc = await buildTripPdf({ trip, settlement, profile });
      downloadBlob(doc.output('blob'), tripPdfFilename(trip));
    } catch (e) {
      toast(`Couldn’t build the PDF: ${e.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeTrip() {
    if (!window.confirm(`Delete the trip “${trip.name}”? Bills from it stay in your ledger.`)) return;
    for (const e of trip.entries) {
      const linked = e.linkedExpenseId && expenses.find((x) => x.id === e.linkedExpenseId);
      if (linked) { const { excludeFromSpend: _x, tripId: _t, ...plain } = linked; await saveExpense(plain); }
    }
    await deleteTrip(trip.id);
    window.location.hash = '#/trips';
  }

  const shareLogged = expenses.find((x) => x.id === `trip-share-${trip.id}`);
  const myRow = settlement.members.find((m) => m.isMe);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <input className="w-full bg-transparent text-2xl font-bold tracking-tight outline-none focus:underline" value={trip.name} onChange={(e) => update({ ...trip, name: e.target.value })} aria-label="Trip name" />
          <p className="text-sm text-slate-600">{trip.members.length} people · {trip.entries.length} expenses · total {money(settlement.total, region)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={trip.status === 'settled' ? 'outline' : 'ghost'} icon={CircleCheck} onClick={() => update({ ...trip, status: trip.status === 'settled' ? 'active' : 'settled' })}>{trip.status === 'settled' ? 'Settled ✓' : 'Mark settled'}</Button>
          <Button icon={busy ? LoaderCircle : FileDown} disabled={busy || !trip.entries.length} onClick={pdf}>Trip PDF</Button>
          <Button variant="ghost" icon={Trash} onClick={removeTrip}>Delete</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="mr-auto font-bold">Expenses</h2>
              <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Add expense</Button>
              <Button icon={ScanText} onClick={() => setPicking(true)}>From ledger</Button>
            </div>
            {trip.entries.length ? (
              <ul className="divide-y divide-slate-100">
                {[...trip.entries].sort((a, b) => (b.dateAD || '').localeCompare(a.dateAD || '')).map((e) => {
                  const linked = e.linkedExpenseId && expenses.find((x) => x.id === e.linkedExpenseId);
                  const { shares } = entryShares(e, trip.members);
                  return (
                    <li key={e.id} className="flex flex-wrap items-center gap-3 py-2.5">
                      {e.hasBill ? <Receipt className="size-5 text-slate-500" /> : <NotebookPen className="size-5 text-slate-400" />}
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{e.title}</div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                          <span>{formatAD(e.dateAD)} · paid by {byId[e.paidByMemberId]?.name || '?'} · {e.hasBill ? 'bill' : 'no bill'}</span>
                          {[...new Set(e.items.map((it) => it.category))].map((c) => <CatChip key={c} cat={c} />)}
                          {linked && <StatusBadge status={getIrdStatus(linked)} />}
                        </div>
                        {me && shares[me.id] && <div className="text-xs text-slate-500">your part {money(shares[me.id].total, region)}</div>}
                      </div>
                      <span className="num font-bold">{money(e.totalAmount, region)}</span>
                      <button type="button" onClick={() => setEditing(e)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label={`Edit ${e.title}`}><Pencil className="size-4" /></button>
                      <button type="button" onClick={() => removeEntry(e)} className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-brand" aria-label={`Remove ${e.title}`}><Trash className="size-4" /></button>
                    </li>
                  );
                })}
              </ul>
            ) : <EmptyState icon={NotebookPen} title="No expenses yet">Add a taxi fare, a hotel bill, a round of drinks… with or without a bill.</EmptyState>}
          </Card>
          <MembersCard trip={trip} update={update} myQr={myQr} />
        </div>
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Settlement trip={trip} settlement={settlement} update={update} myQr={myQr} region={region} />
          {myRow && trip.entries.length > 0 && (
            <Card className="p-4 text-sm">
              <p>Your real trip spend is <b className="num">{money(myRow.totalConsumed, region)}</b>. Bills you paid stay in the IRD tracker but don’t count as spending.</p>
              <Button variant="dark" icon={NotebookPen} className="mt-3" onClick={logMyShare}>{shareLogged ? 'Update my trip share in the ledger' : 'Log My Final Trip Share to Personal Ledger'}</Button>
              {shareLogged && Math.abs(shareLogged.totalAmount - myRow.totalConsumed) >= 0.01 && <p className="mt-2 text-xs font-semibold text-amber-900">The ledger shows {money(shareLogged.totalAmount, region)}; update it to match.</p>}
            </Card>
          )}
        </div>
      </div>

      {editing && <EntryModal trip={trip} entry={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={saveEntry} />}
      {picking && <LedgerPicker trip={trip} onPick={addFromLedger} onClose={() => setPicking(false)} />}
    </div>
  );
}

