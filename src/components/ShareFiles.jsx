// Sending a trip or a split to friends as a file (through the phone's share sheet), and opening
// one a friend sent: a trip merges into yours (or comes in new), a split shows your share.
// The logic is in lib/share.js; received splits are kept in localStorage.
import { withPhotos } from '../lib/photos.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, FileUp, Luggage, Send, Trash, UserPlus, Users } from 'lucide-react';
import { CATEGORIES, PAYMENT } from '../lib/constants.js';
import { blankExpense } from '../lib/expense.js';
import { downloadBlob, money } from '../lib/format.js';
import { adToBs, todayAD } from '../lib/nepaliDate.js';
import { mergeTrip, parseShareFile, shareFileName, tripFromShare, tripShareFile } from '../lib/share.js';
import { useStore } from '../store.jsx';
import { useToast } from './Toast.jsx';
import { Button, Modal, Toggle } from './ui.jsx';

/* ---------- sending ---------- */

/** Hands the file to the share sheet (AirDrop, WhatsApp…), or downloads it where there's none. */
export async function sendShareFile(data, name, title) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: `${title} from BillKhata. Open it in BillKhata → Split → Open a file from a friend.` });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, name);
  return 'downloaded';
}

const mb = (bytes) => (bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(1)} MB`);

/** "Send to friends" for a trip: with or without bill photos, then the share sheet. */
export function SendTripSheet({ tripId, onClose }) {
  const { trips, expenses, profile } = useStore();
  const toast = useToast();
  const trip = trips.find((t) => t.id === tripId);
  const [photos, setPhotos] = useState(true);
  const [busy, setBusy] = useState(false);
  const sizes = useMemo(() => {
    if (!trip) return { with: 0, without: 0 };
    // Without building the photos in: their sizes are known (photoBytes on each ledger bill).
    const wo = JSON.stringify(tripShareFile(trip, { expenses, photos: false })).length;
    const byId = new Map(expenses.map((e) => [e.id, e]));
    const pics = trip.entries.reduce((n, x) => n + (x.receiptImage?.length || byId.get(x.linkedExpenseId)?.photoBytes || 0), 0);
    return { with: wo + pics, without: wo };
  }, [trip, expenses]);
  if (!trip) return null;
  const others = trip.members.filter((m) => !m.isMe);
  async function send() {
    setBusy(true);
    const me = trip.members.find((m) => m.isMe);
    // The trip's ledger bills with their photos read from the photos store (only these, only now).
    const linked = expenses.filter((e) => trip.entries.some((x) => x.linkedExpenseId === e.id));
    const data = tripShareFile(trip, { expenses: photos ? await withPhotos(linked) : linked, photos, from: me?.name || profile.fullName?.split(' ')[0] || '' });
    const how = await sendShareFile(data, shareFileName('trip', trip.name), trip.name);
    setBusy(false);
    if (how === 'cancelled') return;
    toast(how === 'shared' ? 'Sent. Your friends open it in BillKhata → Split → Open a file from a friend.' : 'Trip file downloaded. Send it to your friends (WhatsApp, AirDrop…); they open it in BillKhata.');
    onClose();
  }
  return (
    <Modal open size="md" title={`Send ${trip.name} to friends`} subtitle="They open it in BillKhata and it joins their copy of the trip" onClose={onClose}
      footer={<Button variant="primary" size="lg" icon={Send} className="w-full" disabled={busy} onClick={send}>Send the trip</Button>}>
      <div className="space-y-4">
        <ol className="t-label list-decimal space-y-1.5 pl-5 text-ink-2">
          <li>Send this file to {others.length ? others.map((m) => m.name).join(', ') : 'your friends'} (AirDrop, WhatsApp, Viber…).</li>
          <li>They open BillKhata → Split → <b>Open a file from a friend</b> and pick it.</li>
          <li>Their expenses come back the same way: everything is merged, nothing counted twice.</li>
        </ol>
        <div className="rounded-[14px] border border-line p-3">
          <Toggle id="send-photos" checked={photos} onChange={setPhotos} label="Include bill photos" description={`File size about ${mb(photos ? sizes.with : sizes.without)}${photos ? '' : ` (${mb(sizes.with)} with photos)`}`} />
        </div>
        <p className="t-caption text-ink-3">The file has the trip’s people, expenses and who paid what. It goes only where you send it: BillKhata has no server.</p>
      </div>
    </Modal>
  );
}

/* ---------- received splits ---------- */

const RECEIVED_KEY = 'billkhata_received_splits';
export function loadReceived() {
  try { const v = JSON.parse(localStorage.getItem(RECEIVED_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function saveReceived(list) {
  try { localStorage.setItem(RECEIVED_KEY, JSON.stringify(list.slice(-50))); } catch { /* full */ }
  window.dispatchEvent(new Event('billkhata-received'));
}

/** "Shared with you" in Split: splits friends sent, with your share and Add my share to my ledger. */
export function ReceivedSplits() {
  const { saveExpense, profile } = useStore();
  const toast = useToast();
  const [list, setList] = useState(loadReceived);
  useEffect(() => {
    const on = () => setList(loadReceived());
    window.addEventListener('billkhata-received', on);
    return () => window.removeEventListener('billkhata-received', on);
  }, []);
  if (!list.length) return null;
  const update = (next) => { setList(next); saveReceived(next); };
  async function addMine(r) {
    const me = r.split.people.find((p) => p.id === r.meId);
    if (!me) return;
    const day = r.split.dateAD || todayAD();
    await saveExpense({
      ...blankExpense(profile.region),
      merchantName: `${r.split.title} (my share)`,
      totalAmount: me.share,
      billDateAD: day,
      billDateBS: adToBs(day) || '',
      category: CATEGORIES.includes(r.split.category) ? r.split.category : CATEGORIES[0],
      paymentMethod: PAYMENT.CASH,
      isNepalBill: false,
      quick: true,
      notes: `${r.from || 'A friend'} paid the bill; this is my part.`,
    });
    update(list.map((x) => (x.key === r.key ? { ...x, added: true } : x)));
    toast(`${money(me.share)} added to your ledger as your share of ${r.split.title}.`);
  }
  return (
    <section className="card rounded-2xl">
      <h2 className="border-b border-line px-4 py-3 font-bold">Shared with you</h2>
      <ul className="divide-y divide-line">
        {[...list].reverse().map((r) => {
          const me = r.split.people.find((p) => p.id === r.meId);
          return (
            <li key={r.key} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink">{r.split.title}</span>
                  <span className="t-caption block text-ink-3">From {r.from || 'a friend'} · bill {money(r.split.total)} · {r.split.people.length} people</span>
                </span>
                <span className="text-right">
                  <span className="t-caption block text-ink-3">Your share</span>
                  <span className="num block font-nepali text-[16px] font-semibold text-ink">{money(me?.share || 0)}</span>
                </span>
              </div>
              {r.split.pay?.number && me && !me.isPayer && <p className="t-label mt-1.5 text-ink-2">Pay {r.split.payerName || r.from} on {r.split.pay.via} <b className="num">{r.split.pay.number}</b>. Check the number with them before paying.</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {me && !me.isPayer && (r.added
                  ? <span className="t-label inline-flex items-center gap-1 text-leaf"><Check className="size-4" />In your ledger</span>
                  : <Button size="sm" onClick={() => addMine(r)}>Add my share to my ledger</Button>)}
                <button type="button" onClick={() => update(list.filter((x) => x.key !== r.key))} className="tap ml-auto rounded-full p-2 text-ink-3 hover:text-danger" aria-label={`Remove ${r.split.title}`}><Trash className="size-4" /></button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------- receiving ---------- */

/** Open a file from a friend: a trip to merge or import, or a split to keep. */
export function ReceiveSheet({ onClose }) {
  const { trips, saveTrip, profile } = useStore();
  const toast = useToast();
  const input = useRef(null);
  const [data, setData] = useState(null);
  const [meId, setMeId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function pick(file) {
    if (!file) return;
    setError('');
    try {
      const parsed = parseShareFile(await file.text());
      setData(parsed);
      // Already on the trip here: you're whoever you are in your copy.
      if (parsed.type === 'trip') {
        const mine = trips.find((t) => t.id === parsed.trip.id)?.members.find((m) => m.isMe);
        setMeId(mine?.id || '');
      }
    } catch (e) {
      setError(e.message || 'Couldn’t read that file.');
    }
  }

  const local = data?.type === 'trip' ? trips.find((t) => t.id === data.trip.id) : null;
  const preview = local ? mergeTrip(local, data.trip, { from: data.from?.name || '' }) : null;
  const news = preview ? preview.added + preview.updated + preview.removed + preview.qrChanges.length : 0;
  const myFirst = (profile.fullName || '').split(' ')[0] || 'Me';

  async function doTrip() {
    if (local && !news) { onClose(); return; }
    setBusy(true);
    try {
      if (local) {
        await saveTrip(preview.trip, { revive: true });
        const qr = preview.qrChanges.length;
        toast(`${data.trip.name}: ${preview.added} new, ${preview.updated} updated, ${preview.removed} removed.${qr ? ` ${qr} payment QR change${qr === 1 ? '' : 's'} to check under People before anyone pays.` : ''}`, qr ? 'error' : 'success');
      } else {
        await saveTrip(tripFromShare(data.trip, { meId, myName: myFirst }), { revive: true });
        toast(`${data.trip.name} added. Add your own expenses and send it back.`);
      }
      onClose();
      window.location.hash = `#/trip/${encodeURIComponent(data.trip.id)}`;
    } finally {
      setBusy(false);
    }
  }
  function doSplit() {
    const list = loadReceived().filter((r) => r.split.id !== data.split.id);
    saveReceived([...list, { key: `${data.split.id}-${Date.now()}`, from: data.from?.name || '', meId, split: data.split, receivedAt: new Date().toISOString() }]);
    toast(`${data.split.title} is under Split → Shared with you.`);
    onClose();
    window.location.hash = '#/split';
  }

  const pill = (on) => `tap inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-medium ring-1 ring-inset ${on ? 'bg-ink text-ink-inverse ring-ink' : 'bg-surface text-ink ring-line-strong'}`;
  let body;
  let footer = null;
  if (!data) {
    body = (
      <div className="space-y-3">
        <p className="t-body text-ink-2">Pick the trip or split file a friend sent you. On a phone, save it from WhatsApp or Messages to Files (or Downloads) first.</p>
        <input ref={input} type="file" accept="application/json,.json,.billkhata" className="sr-only" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        <Button variant="primary" size="lg" icon={FileUp} className="w-full" onClick={() => input.current?.click()}>Choose the file</Button>
        {error && <p className="t-label text-danger" role="alert">{error}</p>}
      </div>
    );
  } else if (data.type === 'trip' && local) {
    body = (
      <div className="space-y-3">
        <p className="t-body text-ink-2">From <b className="text-ink">{data.from?.name || 'a friend'}</b>: their copy of <b className="text-ink">{data.trip.name}</b>.</p>
        <ul className="t-body space-y-1 rounded-[14px] bg-sunken p-3 text-ink">
          <li><b>{preview.added}</b> new expense{preview.added === 1 ? '' : 's'}</li>
          <li><b>{preview.updated}</b> updated</li>
          <li><b>{preview.removed}</b> removed (deleted on their phone)</li>
        </ul>
        {preview.qrChanges.length > 0 && (
          <p className="t-label rounded-[12px] bg-warn-soft px-3 py-2.5 text-ink">
            <b>Payment QR changed</b> for {preview.qrChanges.map((c) => c.name).join(', ')} in this file. The one you have stays until you check the new one on the trip’s People and accept it. Ask them first: a swapped QR sends money to someone else.
          </p>
        )}
        <p className="t-caption text-ink-3">The newer version of each expense is kept. Nothing is counted twice.</p>
      </div>
    );
    footer = <Button variant="primary" size="lg" icon={Check} className="w-full" disabled={busy} onClick={doTrip}>{news ? 'Merge into my trip' : 'Nothing new: close'}</Button>;
  } else if (data.type === 'trip') {
    body = (
      <div className="space-y-3">
        <p className="t-body text-ink-2"><b className="text-ink">{data.from?.name || 'A friend'}</b> sent the trip <b className="text-ink">{data.trip.name}</b>: {data.trip.members.length} people, {data.trip.entries.length} expense{data.trip.entries.length === 1 ? '' : 's'}.</p>
        <p className="label">Which one are you?</p>
        <div className="flex flex-wrap gap-2">
          {data.trip.members.filter((m) => m.id !== data.from?.memberId).map((m) => (
            <button key={m.id} type="button" aria-pressed={meId === m.id} className={pill(meId === m.id)} onClick={() => setMeId(m.id)}>{meId === m.id && <Check className="size-4" />}{m.name || 'Person'}</button>
          ))}
          <button type="button" aria-pressed={meId === ''} className={pill(meId === '')} onClick={() => setMeId('')}><UserPlus className="size-4" />I’m not on the list</button>
        </div>
        <p className="t-caption text-ink-3">{meId ? 'Your part of the trip is worked out as that person.' : `You’re added as ${myFirst}.`}</p>
      </div>
    );
    footer = <Button variant="primary" size="lg" icon={Luggage} className="w-full" disabled={busy} onClick={doTrip}>Add the trip</Button>;
  } else {
    const people = data.split.people.filter((p) => !p.isPayer);
    body = (
      <div className="space-y-3">
        <p className="t-body text-ink-2"><b className="text-ink">{data.from?.name || 'A friend'}</b> split <b className="text-ink">{data.split.title}</b> ({money(data.split.total)}).</p>
        <p className="label">Which one are you?</p>
        <div className="flex flex-wrap gap-2">
          {people.map((p) => (
            <button key={p.id} type="button" aria-pressed={meId === p.id} className={pill(meId === p.id)} onClick={() => setMeId(p.id)}>
              {meId === p.id && <Check className="size-4" />}{p.name || 'Person'} · {money(p.share)}
            </button>
          ))}
        </div>
      </div>
    );
    footer = <Button variant="primary" size="lg" icon={Users} className="w-full" disabled={!meId} onClick={doSplit}>Keep it under Shared with you</Button>;
  }
  return (
    <Modal open size="md" title="Open a file from a friend" subtitle="A trip or split sent from BillKhata" onClose={onClose} footer={footer}>
      {body}
    </Modal>
  );
}
