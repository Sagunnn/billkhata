// Friend groups (see lib/groups.js): make or edit one, split a bill with it, start a trip with it.
// Used on the Split page, in a split's People step and on Trips. Groups are optional: adding people
// one by one works as before.
import { useMemo, useState } from 'react';
import { Beer, Check, Divide, Drumstick, Leaf, Luggage, Pencil, Plus, ScanLine, Trash, UserPlus, Users, X, Zap } from 'lucide-react';
import { cleanGroup, groupId, removeGroup, setPendingGroup, tripMembersFromGroup, upsertGroup } from '../lib/groups.js';
import { loadFriends, loadGroups, saveGroups } from '../lib/profile.js';
import { makeTrip } from '../lib/trips.js';
import { useStore } from '../store.jsx';
import { useToast } from './Toast.jsx';
import { Button, Field, Modal } from './ui.jsx';
import PixelAvatar, { AvatarButton, GenderButton } from './PixelAvatar.jsx';

/** Saved groups, tidied, and a way to save the list. */
export function useGroups() {
  const [groups, setGroups] = useState(() => loadGroups().map(cleanGroup).filter(Boolean));
  const save = (list) => { saveGroups(list); setGroups(list.map(cleanGroup).filter(Boolean)); };
  return [groups, save];
}

const names = (g, n = 4) => {
  const list = g.members.map((m) => m.name);
  return list.length > n ? `${list.slice(0, n).join(', ')} +${list.length - n}` : list.join(', ');
};

/* ---------- a list of people to edit (a group, or who's on a new trip) ---------- */

const key = (n) => String(n || '').trim().toLowerCase();

/**
 * People with their face, name, Male / Female, Veg / Non-veg, Drinks and a remove button, then
 * "Add a person" and quick picks (saved friends, and `more`: e.g. the group's people taken off).
 * `draft` is the name being typed, kept by the parent so Save can take it too.
 */
function PeopleEditor({ members, onChange, draft, setDraft, more = [], groups = [], label }) {
  const have = new Set(members.map((m) => key(m.name)));
  const friends = useMemo(() => loadFriends(), []);
  const picks = [...new Map([...more, ...friends.slice().reverse()].filter((f) => !have.has(key(f.name))).map((f) => [key(f.name), f])).values()].slice(0, 10);
  const set = (i, patch) => onChange(members.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const add = (list) => {
    const fresh = [];
    for (const p of list) {
      const n = String(p.name || '').trim();
      if (!n || have.has(key(n)) || fresh.some((f) => key(f.name) === key(n))) continue;
      fresh.push({ ...p, name: n, diet: p.diet || 'non-veg', alcohol: Boolean(p.alcohol) });
    }
    if (fresh.length) onChange([...members, ...fresh]);
  };
  const addTyped = () => { add([{ name: draft }]); setDraft(''); };
  return (
    <div>
      <p className="label">{label} ({members.length + 1} with you)</p>
      <ul className="divide-y divide-line rounded-[14px] border border-line">
        <li className="flex items-center gap-2 py-1.5 pl-2 pr-3">
          <AvatarButton person={{ isMe: true }} size={36} />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium leading-5 text-ink">You</span>
            <GenderButton person={{ isMe: true }} />
          </span>
          <span className="t-caption text-ink-3">always in</span>
        </li>
        {members.map((m, i) => (
          <li key={i} className="flex items-center gap-2 py-1.5 pl-2 pr-1">
            <AvatarButton person={m} onChange={(patch) => set(i, patch)} size={36} />
            <span className="min-w-0 flex-1">
              <input aria-label="Name" className="block w-full bg-transparent text-[15px] font-medium leading-5 text-ink focus:outline-none" value={m.name} maxLength={40} onChange={(e) => set(i, { name: e.target.value })} />
              <GenderButton person={m} onChange={(patch) => set(i, patch)} />
            </span>
            <button type="button" onClick={() => set(i, { diet: m.diet === 'veg' ? 'non-veg' : 'veg' })} aria-label={`${m.name}: ${m.diet === 'veg' ? 'veg' : 'non-veg'}, tap to switch`}
              className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset ${m.diet === 'veg' ? 'bg-leaf-soft text-leaf ring-leaf/30' : 'bg-brand-soft text-brand ring-brand/25'}`}>
              {m.diet === 'veg' ? <Leaf className="size-3.5" /> : <Drumstick className="size-3.5" />}{m.diet === 'veg' ? 'Veg' : 'Non-veg'}
            </button>
            <button type="button" aria-pressed={m.alcohol} onClick={() => set(i, { alcohol: !m.alcohol })} aria-label={`${m.name}: ${m.alcohol ? 'drinks' : 'no drinks'}, tap to switch`} title={m.alcohol ? 'Drinks' : 'No drinks'}
              className={`relative flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${m.alcohol ? 'bg-marigold-soft text-marigold-ink ring-marigold/40' : 'bg-surface text-ink-3 ring-line-strong'}`}>
              <Beer className="size-4" />
              {!m.alcohol && <span className="absolute h-0.5 w-5 rotate-45 rounded bg-ink-3/60" />}
            </button>
            <button type="button" onClick={() => onChange(members.filter((_, j) => j !== i))} className="tap flex size-8 shrink-0 items-center justify-center rounded-full text-ink-3 hover:text-danger" aria-label={`Remove ${m.name}`}><X className="size-4" /></button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <input className="input py-2" value={draft} maxLength={40} onChange={(e) => setDraft(e.target.value)} placeholder="Add a person" aria-label="New person's name" enterKeyHint="done"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (draft.trim()) addTyped(); } }} />
        <Button type="button" icon={UserPlus} onClick={addTyped} disabled={!draft.trim()}>Add</Button>
      </div>
      {(picks.length > 0 || groups.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {groups.filter((g) => g.members.some((m) => !have.has(key(m.name)))).map((g) => (
            <button key={g.id} type="button" className="chip tap h-8 text-[13px]" onClick={() => add(g.members)}><Users className="size-3.5" />{g.name}</button>
          ))}
          {picks.map((f) => (
            <button key={f.name} type="button" className="chip tap h-8 pl-1 text-[13px]" onClick={() => add([f])}>
              <PixelAvatar person={f} size={22} rounded="rounded-[6px]" /><Plus className="-mr-1 size-3.5" />{f.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- make or edit a group ---------- */

/** `group`: one to edit; or { members } to start a new one from a split's people. */
export function GroupSheet({ group, groups, onSave, onClose }) {
  const toast = useToast();
  const editing = Boolean(group?.id);
  const [name, setName] = useState(group?.name || '');
  const [members, setMembers] = useState(() => (group?.members || []).map((m) => ({ ...m })));
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  function save() {
    try {
      const list = upsertGroup(groups, { id: group?.id, name, members: draft.trim() ? [...members, { name: draft }] : members });
      onSave(list);
      toast(editing ? `${name.trim()} saved.` : `Group “${name.trim()}” made. Use it to split a bill or start a trip.`);
      onClose();
    } catch (e) { setError(e.message); }
  }
  function remove() {
    if (!window.confirm(`Delete the group “${group.name}”? Splits and trips with these people stay.`)) return;
    onSave(removeGroup(groups, group.id));
    toast(`Group “${group.name}” deleted.`);
    onClose();
  }
  return (
    <Modal open size="md" onClose={onClose} title={editing ? 'Edit group' : 'New group'} subtitle="Friends you often eat out or travel with"
      footer={(
        <>
          {editing && <Button variant="danger" icon={Trash} className="mr-auto" onClick={remove}>Delete</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Check} onClick={save}>{editing ? 'Save' : 'Make group'}</Button>
        </>
      )}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Group name" htmlFor="gr-name">
          <input id="gr-name" className="input" value={name} maxLength={40} onChange={(e) => { setName(e.target.value); setError(''); }} placeholder="Office lunch, Trek gang, Flatmates…" autoFocus={!editing} autoComplete="off" />
        </Field>
        <PeopleEditor label="People" members={members} onChange={(m) => { setMembers(m); setError(''); }} draft={draft} setDraft={(v) => { setDraft(v); setError(''); }} />
        {error && <p className="t-caption text-danger" role="alert">{error}</p>}
        <p className="t-caption text-ink-3">Tap a face for a new look; male or female picks the style. Veg and drinks decide who shares which items. Anyone who isn't there on the day can be marked Not here.</p>
        <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>Save</button>
      </form>
    </Modal>
  );
}

/* ---------- split a bill with a group ---------- */

/** How to get the bill; the group's people are filled in when the split opens. */
export function SplitWithGroupSheet({ group, onPickSaved, onClose }) {
  const { openSheet } = useStore();
  const go = (fn) => { setPendingGroup(group); fn(); };
  const row = (Icon, tone, title, text, onClick) => (
    <button type="button" onClick={onClick} className="card flex w-full items-center gap-3 rounded-2xl p-3.5 text-left hover:border-line-strong">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-[12px] ${tone}`}><Icon className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-ink">{title}</span>
        <span className="t-caption block text-ink-3">{text}</span>
      </span>
    </button>
  );
  return (
    <Modal open size="md" onClose={onClose} title={`Split with ${group.name}`} subtitle={`${group.members.length + 1} people with you · mark anyone who wasn't there as Not here next`}>
      <div className="space-y-2">
        {row(ScanLine, 'bg-brand-soft text-brand', 'Scan a bill', 'Read the items, then who had what', () => go(() => { onClose(); window.location.hash = '#/scan?split'; }))}
        {row(Divide, 'bg-navy-soft text-navy', 'A saved bill', 'One you already scanned or added', () => go(() => { onClose(); onPickSaved?.(); }))}
        {row(Zap, 'bg-leaf-soft text-leaf', 'No bill', 'A taxi, snacks: type the amount', () => go(() => { onClose(); openSheet('quickOut', { split: true }); }))}
      </div>
    </Modal>
  );
}

/* ---------- start a trip (with a group, or anyone) ---------- */

/** Name the trip and say who's coming: a group's people to start with, anyone added or removed. */
export function StartTripSheet({ group = null, name: startName = '', onClose }) {
  const { profile, saveTrip } = useStore();
  const toast = useToast();
  const [groups] = useGroups();
  const [name, setName] = useState(startName);
  const [people, setPeople] = useState(() => (group?.members || []).map((m) => ({ ...m })));
  const [draft, setDraft] = useState('');
  const coming = draft.trim() && !people.some((p) => key(p.name) === key(draft)) ? [...people, { name: draft.trim(), diet: 'non-veg', alcohol: false }] : people;
  async function start() {
    const trip = makeTrip({ name: name.trim() || (group ? `${group.name} trip` : 'New trip'), profile });
    trip.members = [...trip.members, ...tripMembersFromGroup({ members: coming }, { existing: trip.members })];
    const t = await saveTrip(trip);
    toast(`${t.name} started with ${t.members.length} ${t.members.length === 1 ? 'person' : 'people'}.`);
    onClose();
    window.location.hash = `#/trip/${encodeURIComponent(t.id)}`;
  }
  return (
    <Modal open keepFooter size="md" onClose={onClose} title={group ? `Trip with ${group.name}` : 'Start a trip'} subtitle="Who's coming? Add or remove anyone"
      footer={<Button variant="primary" size="lg" icon={Luggage} className="w-full" onClick={start}>Start trip with {coming.length + 1} {coming.length ? 'people' : 'person'}</Button>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); start(); }}>
        <Field label="Trip name" htmlFor="st-trip">
          <input id="st-trip" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={group ? `${group.name} trip, Nagarkot weekend…` : 'Nagarkot weekend, Pokhara trek…'} autoComplete="off" autoFocus={!group && !startName} />
        </Field>
        <PeopleEditor label="Coming" members={people} onChange={setPeople} draft={draft} setDraft={setDraft}
          more={group ? group.members : []} groups={groups.filter((g) => !group || groupId(g) !== groupId(group))} />
        <p className="t-caption text-ink-3">You can still add or remove people on the trip page. Someone joining late or leaving early: mark them Not here there, and new expenses leave them out.</p>
        <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>Start</button>
      </form>
    </Modal>
  );
}

/* ---------- the groups card (Split page) ---------- */

/** "Your groups": each with Split a bill and Start a trip; make a new one. */
export function GroupsCard({ onPickSaved }) {
  const [groups, saveList] = useGroups();
  const [editing, setEditing] = useState(null); // group | {} (new)
  const [splitting, setSplitting] = useState(null);
  const [tripping, setTripping] = useState(null);
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="t-h-m text-ink">Your groups</h2>
        {groups.length > 0 && <button type="button" onClick={() => setEditing({})} className="t-label inline-flex items-center gap-1 font-medium text-brand hover:underline"><Plus className="size-4" />New group</button>}
      </div>
      {groups.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <li key={groupId(g)} className="card rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <span className="min-w-0 flex-1">
                  <span className="mb-2 flex -space-x-2">
                    <PixelAvatar person={{ isMe: true }} size={32} className="ring-2 ring-surface" />
                    {g.members.slice(0, 6).map((m) => <PixelAvatar key={m.name} person={m} size={32} className="ring-2 ring-surface" />)}
                    {g.members.length > 6 && <span className="t-caption flex size-8 items-center justify-center rounded-[10px] bg-sunken text-ink-2">+{g.members.length - 6}</span>}
                  </span>
                  <span className="block truncate text-[15px] font-semibold text-ink">{g.name}</span>
                  <span className="t-caption block truncate text-ink-3">You, {names(g)}</span>
                </span>
                <button type="button" onClick={() => setEditing(g)} className="tap -mr-2 -mt-1 rounded-full p-2 text-ink-3 hover:bg-sunken hover:text-ink" aria-label={`Edit group ${g.name}`}><Pencil className="size-4" /></button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button size="sm" icon={Divide} onClick={() => setSplitting(g)}>Split a bill</Button>
                <Button size="sm" icon={Luggage} onClick={() => setTripping(g)}>Start a trip</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <button type="button" onClick={() => setEditing({})} className="card flex w-full items-center gap-3 rounded-2xl p-4 text-left hover:border-line-strong">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-navy-soft text-navy"><Users className="size-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-ink">Make a group of friends</span>
            <span className="t-caption block text-ink-3">Save them once, then split a bill or start a trip in one tap. Or keep adding people one by one.</span>
          </span>
          <Plus className="size-5 shrink-0 text-ink-3" />
        </button>
      )}
      {editing && <GroupSheet group={editing.id ? editing : null} groups={groups} onSave={saveList} onClose={() => setEditing(null)} />}
      {splitting && <SplitWithGroupSheet group={splitting} onPickSaved={onPickSaved} onClose={() => setSplitting(null)} />}
      {tripping && <StartTripSheet group={tripping} onClose={() => setTripping(null)} />}
    </section>
  );
}
