// Friend groups: people you often go out with, saved once, then used to split a bill or start a
// trip in one tap. Anyone who wasn't there is marked "not here" (a split) or left off (a trip).
// Pure functions; stored by profile.js (localStorage, in backups); tests in tests/groups.test.js.
import { face, makeMember } from './splitter.js';
import { makeTripMember } from './trips.js';

const key = (s) => String(s || '').trim().toLowerCase();
const slug = (s) => key(s).replace(/[^a-z0-9\u0900-\u097f]+/g, '-').replace(/^-|-$/g, '') || 'group';

/** A group's id: its own, or one from its name (groups saved before ids existed). */
export const groupId = (g) => g.id || `g-${slug(g.name)}`;

/** A stored or backed-up group, tidied: [{ name, diet: 'veg'|'non-veg', alcohol }], one per name. */
export function cleanGroup(g) {
  if (!g || !String(g.name || '').trim() || !Array.isArray(g.members)) return null;
  const seen = new Set();
  const members = g.members
    .filter((m) => m && String(m.name || '').trim())
    .filter((m) => !seen.has(key(m.name)) && seen.add(key(m.name)))
    .map((m) => ({ name: String(m.name).trim().slice(0, 40), diet: m.diet === 'veg' ? 'veg' : 'non-veg', alcohol: Boolean(m.alcohol), ...face(m.gender, m.look) }));
  return { id: groupId(g), name: String(g.name).trim().slice(0, 40), members };
}

/**
 * A new or changed group into the list (it replaces the one with its id). Throws a plain-language
 * error when it has no name or nobody in it, or another group already has that name.
 */
export function upsertGroup(list, group, now = new Date()) {
  const name = String(group.name || '').trim();
  if (!name) throw new Error('Give the group a name.');
  const id = group.id || `g-${slug(name)}-${now.getTime().toString(36)}`;
  const g = cleanGroup({ ...group, id, name });
  if (!g.members.length) throw new Error('Add at least one person.');
  if (list.some((x) => groupId(x) !== id && key(x.name) === key(name))) throw new Error(`You already have a group called “${name}”.`);
  const rest = list.filter((x) => groupId(x) !== id);
  return [...rest, g].slice(-20);
}

export const removeGroup = (list, id) => list.filter((g) => groupId(g) !== id);

/** A split's people (or a group's) as a group's members: everyone except the one who paid. */
export const groupMembersFrom = (members) => members.filter((m) => !m.isPayer && !m.isMe && String(m.name || '').trim())
  .map((m) => ({ name: m.name, diet: m.diet || (m.isVeg ? 'veg' : 'non-veg'), alcohol: m.alcohol ?? Boolean(m.drinks), ...face(m.gender, m.look) }));

/**
 * A group's people for a split, after whoever is already in it: everyone is in, except the names
 * in `notHere` (they stay listed as "Not here" and pay nothing).
 */
export function splitMembersFromGroup(group, { existing = [], notHere = [] } = {}) {
  const have = new Set(existing.map((m) => key(m.name)));
  const away = new Set(notHere.map(key));
  return group.members.filter((m) => !have.has(key(m.name))).map((m) => makeMember({ ...m, out: away.has(key(m.name)) }));
}

/**
 * A group's people for a trip: the ones coming (all when `coming` isn't given), without anyone
 * already on it (you are on every trip).
 */
export function tripMembersFromGroup(group, { existing = [], coming } = {}) {
  const have = new Set(existing.map((m) => key(m.name)));
  const yes = coming ? new Set([...coming].map(key)) : null;
  return group.members
    .filter((m) => !have.has(key(m.name)) && (!yes || yes.has(key(m.name))))
    .map((m) => makeTripMember({ name: m.name, isVeg: m.diet === 'veg', drinks: m.alcohol, gender: m.gender, look: m.look }));
}

/* ---------- "Split a bill" with a group: remembered until the next new split opens ---------- */

const PENDING = 'billkhata_split_group';
const PENDING_FOR = 30 * 60e3;

export function setPendingGroup(group, store = globalThis.sessionStorage) {
  try { store?.setItem(PENDING, JSON.stringify({ group, at: Date.now() })); } catch { /* private mode */ }
}

/** The group picked for the next split (only for half an hour), or null. */
export function peekPendingGroup(store = globalThis.sessionStorage, now = Date.now()) {
  try {
    const v = JSON.parse(store?.getItem(PENDING) || 'null');
    return v && now - v.at < PENDING_FOR ? cleanGroup(v.group) : null;
  } catch { return null; }
}

export function clearPendingGroup(store = globalThis.sessionStorage) {
  try { store?.removeItem(PENDING); } catch { /* ignore */ }
}
