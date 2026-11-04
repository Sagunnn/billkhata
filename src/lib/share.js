// Sending a trip or a split to a friend as a file, and merging what comes back. No server: the file
// goes through the phone's share sheet (AirDrop, WhatsApp, Nearby Share…) and is merged here.
// Pure functions, unit-tested (tests/share.test.js).
//
// Merging needs to know what changed, so every trip expense and person carries `updatedAt`, and a
// trip remembers deleted expenses in `deleted: { entryId: deletedAt }` (stampTrip, on every save).
// Who "me" is stays on each phone: `isMe` is never taken from a file.

export const SHARE_KIND = 'billkhata-share';
export const SHARE_VERSION = 1;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const strip = ({ updatedAt: _u, ...rest }) => rest;

/**
 * Before a trip is saved: stamps the expenses and people that changed (or are new) with `now`, and
 * records expenses that were removed, so a later merge knows which side is newer.
 */
export function stampTrip(before, next, now = new Date().toISOString()) {
  const prevE = new Map((before?.entries || []).map((e) => [e.id, e]));
  const prevM = new Map((before?.members || []).map((m) => [m.id, m]));
  // Unchanged: keeps its time. Changed here: now. Its own different time (taken from a friend's
  // copy by mergeTrip): kept, so the merge doesn't look like a fresh edit.
  const stamp = (x, old) => {
    if (x.updatedAt && x.updatedAt !== old?.updatedAt) return x;
    if (old && same(strip(old), strip(x)) && old.updatedAt) return { ...x, updatedAt: old.updatedAt };
    return { ...x, updatedAt: now };
  };
  const entries = (next.entries || []).map((e) => stamp(e, prevE.get(e.id)));
  const members = (next.members || []).map((m) => stamp(m, prevM.get(m.id)));
  const deleted = { ...(before?.deleted || {}), ...(next.deleted || {}) };
  const ids = new Set(entries.map((e) => e.id));
  for (const id of prevE.keys()) if (!ids.has(id) && !deleted[id]) deleted[id] = now;
  return { ...next, entries, members, deleted };
}

/**
 * A trip as a file for friends. Bill photos kept in your ledger go along when `photos` is on; your
 * own ledger links and who "me" is don't (each phone knows that itself).
 */
export function tripShareFile(trip, { expenses = [], photos = true, from = '', now = new Date().toISOString() } = {}) {
  const byId = new Map(expenses.map((e) => [e.id, e]));
  const me = trip.members.find((m) => m.isMe);
  const entries = trip.entries.map((e) => {
    const photo = e.receiptImage || (e.linkedExpenseId && byId.get(e.linkedExpenseId)?.receiptImage) || '';
    const { receiptImage: _r, ...rest } = e;
    return photos && photo ? { ...rest, receiptImage: photo } : rest;
  });
  const members = trip.members.map(({ isMe: _m, ...m }) => m);
  return {
    kind: SHARE_KIND, v: SHARE_VERSION, type: 'trip', sharedAt: now,
    from: { name: from || me?.name || '', memberId: me?.id || '' },
    trip: { ...trip, entries, members, isMe: undefined },
  };
}

/** A split bill as a file: the bill, who had what, everyone's share, and where to pay. */
export function splitShareFile(expense, result, { payer = {}, pay = null, from = '', now = new Date().toISOString() } = {}) {
  const split = expense.split || {};
  return {
    kind: SHARE_KIND, v: SHARE_VERSION, type: 'split', sharedAt: now,
    from: { name: from || payer.name || '' },
    split: {
      id: expense.id,
      title: expense.merchantName || split.title || 'Bill',
      dateAD: expense.billDateAD || '',
      dateBS: expense.billDateBS || '',
      category: expense.category || '',
      total: Number(expense.totalAmount) || 0,
      mode: split.mode || 'equal',
      people: result.members.filter((m) => !m.out).map((m) => ({
        id: m.id, name: m.name, isPayer: Boolean(m.isPayer), share: m.share,
        lines: (m.lines || []).map((l) => ({ name: l.name, amount: l.amount })), extra: m.extra || 0,
      })),
      pay: pay ? { via: pay.via, number: pay.number } : null,
      payerName: payer.name || '',
    },
  };
}

/** Reads a file a friend sent. Throws a plain-language error when it isn't one. */
export function parseShareFile(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That isn’t a BillKhata file. Ask your friend to send it again from Send to friends.'); }
  if (data?.kind !== SHARE_KIND) {
    if (data?.version && data?.expenses) throw new Error('That’s a full BillKhata backup. Restore it in Settings → Backup & restore instead.');
    throw new Error('That isn’t a BillKhata trip or split file.');
  }
  if (data.v > SHARE_VERSION) throw new Error('This file is from a newer BillKhata. Reload the app to update it, then open the file again.');
  if (data.type === 'trip') {
    const t = data.trip;
    if (!t?.id || !Array.isArray(t.members) || !Array.isArray(t.entries)) throw new Error('This trip file is incomplete.');
  } else if (data.type === 'split') {
    if (!data.split?.id || !Array.isArray(data.split.people)) throw new Error('This split file is incomplete.');
  } else {
    throw new Error('That isn’t a BillKhata trip or split file.');
  }
  return data;
}

const newer = (a, b) => String(a?.updatedAt || '') > String(b?.updatedAt || '');

/**
 * Two copies of a trip into one: for each expense and person the newer copy wins; an expense
 * deleted on either phone (after its last change) stays deleted; payments marked done on either
 * count. Your own `isMe`, name for the trip and ledger links stay as they are here.
 * @returns {{ trip, added: number, updated: number, removed: number }}
 */
export function mergeTrip(local, incoming) {
  const deleted = { ...(incoming.deleted || {}) };
  for (const [id, at] of Object.entries(local.deleted || {})) if (!deleted[id] || at > deleted[id]) deleted[id] = at;
  const mine = new Map(local.entries.map((e) => [e.id, e]));
  const theirs = new Map(incoming.entries.map((e) => [e.id, e]));
  let added = 0;
  let updated = 0;
  let removed = 0;
  const entries = [];
  for (const id of new Set([...mine.keys(), ...theirs.keys()])) {
    const L = mine.get(id);
    const I = theirs.get(id);
    let pick = L && I ? (newer(I, L) ? I : L) : L || I;
    if (deleted[id] && deleted[id] >= String(pick.updatedAt || '')) { if (L) removed++; continue; }
    if (pick === I && L) {
      // Their newer copy of an expense you have: keep your ledger link (the photo lives there).
      pick = L.linkedExpenseId ? { ...I, linkedExpenseId: L.linkedExpenseId, receiptImage: undefined } : I;
      if (!same(strip(L), strip(pick))) updated++;
    } else if (!L) {
      pick = { ...I, linkedExpenseId: '' }; // their ledger, not yours
      added++;
    }
    entries.push(pick);
  }
  const people = new Map(local.members.map((m) => [m.id, m]));
  for (const m of incoming.members) {
    const L = people.get(m.id);
    if (!L) people.set(m.id, { ...m, isMe: false });
    else if (newer(m, L)) people.set(m.id, { ...m, isMe: L.isMe });
  }
  const paidTransfers = { ...(incoming.paidTransfers || {}), ...(local.paidTransfers || {}) };
  for (const [k, v] of Object.entries(incoming.paidTransfers || {})) if (v && !local.paidTransfers?.[k]) paidTransfers[k] = v;
  return {
    trip: { ...local, entries, members: [...people.values()], deleted, paidTransfers },
    added, updated, removed,
  };
}

/**
 * A trip that isn't on this phone yet, from a file: the people as in the file, and you are the one
 * you picked (or a new person when you're not on the list).
 */
export function tripFromShare(incoming, { meId = '', myName = 'Me' } = {}) {
  const members = incoming.members.map((m) => ({ ...m, isMe: m.id === meId }));
  if (!meId) members.push({ id: `m${Date.now().toString(36)}`, name: myName, isVeg: false, drinks: true, paymentQrRaw: '', isMe: true, updatedAt: new Date().toISOString() });
  const entries = incoming.entries.map((e) => ({ ...e, linkedExpenseId: '' }));
  return { ...incoming, members, entries, status: incoming.status || 'active' };
}

/** "trip-nagarkot-weekend-2026-11-04.json" */
export function shareFileName(kind, title, now = new Date()) {
  const slug = String(title || kind).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || kind;
  return `billkhata-${kind}-${slug}-${now.toISOString().slice(0, 10)}.json`;
}
