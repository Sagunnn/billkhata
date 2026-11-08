// Pass the phone: a split's people take the phone one at a time, like a party game. Each one sees
// the bill's items (ticked by their veg / drinks choices) and unticks what they didn't have. Someone
// who wasn't there is marked Not here. Then everyone's share, and anything nobody claimed.
import { useEffect, useState } from 'react';
import { Check, ChevronRight, Minus, Plus, Smartphone, UserX, X } from 'lucide-react';
import { money } from '../lib/format.js';
import { autoWeight, computeSplit, weightOf } from '../lib/splitter.js';
import { Button } from './ui.jsx';
import PixelAvatar from './PixelAvatar.jsx';

/** The split with one person's count of one item set (back to the automatic tick when it matches). */
export function withWeight(split, item, member, w) {
  const row = { ...(split.overrides?.[item.id] || {}) };
  if (w === autoWeight(item.tag, member)) delete row[member.id];
  else row[member.id] = Math.max(0, w);
  const overrides = { ...split.overrides, [item.id]: row };
  if (!Object.keys(row).length) delete overrides[item.id];
  return { ...split, overrides };
}

/** An item nobody ticked goes back to everyone it would be on by default (veg / drinks). */
export function shareWithEveryone(split, item) {
  const { [item.id]: _drop, ...overrides } = split.overrides || {};
  return { ...split, overrides };
}

export default function PassAround({ split, update, region, onClose }) {
  // Everyone who was there, in the order they're listed (the payer, holding the phone, first).
  const [order] = useState(() => split.members.filter((m) => !m.out).map((m) => m.id));
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState('pass'); // pass | pick | done
  const byId = Object.fromEntries(split.members.map((m) => [m.id, m]));
  const live = order.filter((id) => byId[id] && !byId[id].out);
  const person = byId[order[i]];
  const result = computeSplit(split);
  const shareOf = (id) => result.members.find((r) => r.id === id)?.share || 0;
  const nextIndex = (from) => { let k = from + 1; while (k < order.length && byId[order[k]]?.out) k++; return k; };
  const next = nextIndex(i);
  const nextPerson = byId[order[next]];

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose]);
  useEffect(() => { window.scrollTo({ top: 0 }); document.getElementById('pass-top')?.scrollIntoView(); }, [i, phase]);

  const goNext = () => { if (next < order.length) { setI(next); setPhase('pass'); } else setPhase('done'); };
  const notHere = () => { update({ ...split, members: split.members.map((m) => (m.id === person.id ? { ...m, out: true } : m)) }); goNext(); };
  const step = live.indexOf(person?.id) + 1;

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-surface" role="dialog" aria-modal="true" aria-label="Pass the phone">
      <div id="pass-top" className="flex items-center gap-3 border-b border-line px-4 pb-3 pt-[calc(0.75rem+var(--safe-top))]">
        <Smartphone className="size-5 text-brand" />
        <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">Pass the phone{phase !== 'done' && person ? ` · ${step} of ${live.length}` : ''}</p>
        <button type="button" onClick={onClose} className="tap -mr-2 rounded-full p-2 text-ink-2 hover:bg-sunken" aria-label="Stop passing (ticks are kept)"><X className="size-5" /></button>
      </div>
      {phase !== 'done' && (
        <div className="flex gap-1 px-4 pt-3" aria-hidden="true">
          {live.map((id) => <span key={id} className={`h-1 flex-1 rounded-full ${live.indexOf(id) < step - (phase === 'pass' ? 1 : 0) ? 'bg-brand' : 'bg-sunken'}`} />)}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {phase === 'pass' && person && (
          <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-5 px-6 py-10 text-center">
            <p className="t-label text-ink-2">Hand the phone to</p>
            <PixelAvatar key={person.id} person={person} size={144} rounded="rounded-[28px]" className="pass-pop shadow-sm" />
            <p className="text-[32px] font-semibold leading-9 text-ink">{person.name || 'Next person'}</p>
            <p className="t-body text-ink-3">{person.name || 'They'} untick{person.name ? 's' : ''} whatever {person.name ? 'they' : 'you'} didn’t have, then pass{person.name ? 'es' : ''} it on.</p>
            <Button variant="primary" size="lg" className="w-full" onClick={() => setPhase('pick')}>I’m {person.name || 'here'}</Button>
            {!person.isPayer && (
              <button type="button" onClick={notHere} className="t-label inline-flex items-center gap-1.5 font-medium text-ink-2 hover:text-ink">
                <UserX className="size-4" />{person.name || 'They'} wasn’t here
              </button>
            )}
          </div>
        )}

        {phase === 'pick' && person && (
          <div className="mx-auto max-w-md px-4 pb-6 pt-4">
            <h2 className="text-[22px] font-semibold leading-7 text-ink">{person.name}, untick what you didn’t have</h2>
            <p className="t-caption mt-1 text-ink-3">Ticked by your choices: {person.diet === 'veg' ? 'veg' : 'non-veg'}{person.alcohol ? ', drinks' : ', no drinks'}. Had more than one of something? Tap +.</p>
            <ul className="mt-4 divide-y divide-line rounded-[14px] border border-line">
              {split.items.map((it) => {
                const w = weightOf(split, it, person);
                const others = split.members.filter((m) => m.id !== person.id && weightOf(split, it, m) > 0).map((m) => m.name || 'Person');
                return (
                  <li key={it.id} className="flex items-center gap-3 px-3 py-3">
                    <button type="button" role="checkbox" aria-checked={w > 0} aria-label={`${person.name} had ${it.name || 'this item'}`}
                      onClick={() => update(withWeight(split, it, person, w > 0 ? 0 : 1))}
                      className="tap flex min-w-0 flex-1 items-center gap-3 text-left">
                      <span className={`flex size-8 shrink-0 items-center justify-center rounded-[10px] border-2 ${w > 0 ? 'border-ink bg-ink text-ink-inverse' : 'border-line-strong bg-surface text-transparent'}`}><Check className="size-5" /></span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-[15px] font-medium ${w > 0 ? 'text-ink' : 'text-ink-3 line-through'}`}>{it.name || 'Item'}{it.qty > 1 ? <span className="font-normal text-ink-3"> ×{it.qty}</span> : null}</span>
                        <span className="t-caption block truncate text-ink-3">{money(it.amount, region)}{others.length ? ` · ${w > 0 ? 'with ' : ''}${others.join(', ')}` : w > 0 ? ' · only you' : ' · nobody yet'}</span>
                      </span>
                    </button>
                    {w > 0 && it.qty > 1 && (
                      <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-sunken p-0.5" title="How many of these you had">
                        <button type="button" className="tap flex size-7 items-center justify-center rounded-full bg-surface disabled:opacity-40" disabled={w <= 1} aria-label="One less" onClick={() => update(withWeight(split, it, person, w - 1))}><Minus className="size-3.5" /></button>
                        <span className="num w-7 text-center text-[13px] font-semibold">×{w}</span>
                        <button type="button" className="tap flex size-7 items-center justify-center rounded-full bg-surface" aria-label="One more" onClick={() => update(withWeight(split, it, person, w + 1))}><Plus className="size-3.5" /></button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {phase === 'done' && (
          <div className="mx-auto max-w-md px-4 pb-6 pt-6">
            <h2 className="text-[24px] font-semibold leading-8 text-ink">Everyone’s done</h2>
            <p className="t-body mt-1 text-ink-2">Hand the phone back to {split.members.find((m) => m.isPayer)?.name || 'whoever paid'}.</p>
            {result.unassigned > 0 && (
              <div className="mt-4 rounded-[14px] bg-marigold-soft px-3.5 py-3">
                <p className="t-label font-semibold text-ink">Nobody had these ({money(result.unassigned, region)})</p>
                <ul className="mt-1.5 space-y-1.5">
                  {split.items.filter((it) => it.amount > 0 && split.members.every((m) => weightOf(split, it, m) === 0)).map((it) => (
                    <li key={it.id} className="t-label flex items-center gap-2 text-ink">
                      <span className="min-w-0 flex-1 truncate">{it.name || 'Item'} · {money(it.amount, region)}</span>
                      <button type="button" className="shrink-0 font-medium text-brand hover:underline" onClick={() => update(shareWithEveryone(split, it))}>Share it</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="mt-4 divide-y divide-line rounded-[14px] border border-line">
              {split.members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-3.5 py-3">
                  <PixelAvatar person={m} size={32} dim={m.out} />
                  <span className={`min-w-0 flex-1 truncate text-[15px] font-medium ${m.out ? 'text-ink-3' : 'text-ink'}`}>{m.name || 'Person'}{m.isPayer ? ' (paid)' : ''}</span>
                  <span className={`num font-nepali text-[16px] font-semibold ${m.out ? 'text-ink-3' : 'text-ink'}`}>{m.out ? 'Not here' : money(shareOf(m.id), region)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="pb-safe-3 border-t border-line px-4 pt-3">
        <div className="mx-auto max-w-md">
          {phase === 'pick' && person && (
            <>
              <p className="t-label mb-2 flex items-center gap-2 text-ink-2"><PixelAvatar person={person} size={24} rounded="rounded-[6px]" /><span className="flex-1">Your share</span><b className="num font-nepali text-ink">{money(shareOf(person.id), region)}</b></p>
              <Button variant="primary" size="lg" className="w-full" icon={next < order.length ? ChevronRight : Check} onClick={goNext}>
                {next < order.length ? `Done · pass to ${nextPerson?.name || 'the next person'}` : 'Done · see everyone'}
              </Button>
            </>
          )}
          {phase === 'done' && <Button variant="primary" size="lg" className="w-full" onClick={onClose}>See shares</Button>}
          {phase === 'pass' && <p className="t-caption pb-1 text-center text-ink-3">Ticks are saved as you go. Close any time.</p>}
        </div>
      </div>
    </div>
  );
}
