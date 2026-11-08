// A person's pixel-art face (lib/pixelAvatar.js). Your own face comes from your saved choice, so
// you look the same in every split and trip; anyone else's from their name, gender and look.
import { useEffect, useMemo, useState } from 'react';
import { avatarPixels, GENDER_LABEL, nextGender } from '../lib/pixelAvatar.js';
import { loadMyAvatar, saveMyAvatar } from '../lib/profile.js';

/** You in a split (the payer with id 'me') or a trip (isMe). */
export const isMine = (p) => Boolean(p?.isMe || (p?.isPayer && p?.id === 'me'));

/** Your saved face, kept up to date when it changes anywhere. */
export function useMyAvatar() {
  const [mine, setMine] = useState(loadMyAvatar);
  useEffect(() => {
    const on = () => setMine(loadMyAvatar());
    window.addEventListener('billkhata-avatar', on);
    return () => window.removeEventListener('billkhata-avatar', on);
  }, []);
  return mine;
}

/** { gender, look } for a person (yours from your saved face). */
export function useLookOf(person) {
  const mine = useMyAvatar();
  return isMine(person) ? mine : { gender: person?.gender || '', look: person?.look || 0 };
}

export default function PixelAvatar({ person, size = 36, dim = false, className = '', rounded = 'rounded-[10px]' }) {
  const { gender, look } = useLookOf(person);
  // Your face doesn't change with how your name is written in a split or a trip.
  const name = isMine(person) ? '\u0000me' : person?.name || '';
  const { bg, cells } = useMemo(() => avatarPixels(name, { gender, look }), [name, gender, look]);
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true"
      className={`shrink-0 overflow-hidden ${rounded} ${dim ? 'opacity-40 grayscale' : ''} ${className}`}>
      <rect width="12" height="12" fill={bg} />
      {cells.map(([x, y, c], i) => <rect key={i} x={x} y={y} width="1" height="1" fill={c} />)}
    </svg>
  );
}

/**
 * The face as a button: a tap draws a new look. `onChange({ look })` saves it on the person; your
 * own is saved for every split and trip.
 */
export function AvatarButton({ person, onChange, size = 36, dim = false, className = '' }) {
  const { gender, look } = useLookOf(person);
  const roll = () => {
    const next = (look || 0) + 1;
    if (isMine(person)) saveMyAvatar({ gender, look: next });
    else onChange?.({ look: next });
  };
  return (
    <button type="button" onClick={roll} title="Tap for a new look" aria-label={`${person?.name || 'Person'}: new look`} className={`tap shrink-0 rounded-[10px] ${className}`}>
      <PixelAvatar person={person} size={size} dim={dim} />
    </button>
  );
}

/** "Male" / "Female" / "Male or female?": a tap switches it (and draws a matching face). */
export function GenderButton({ person, onChange, className = '' }) {
  const { gender, look } = useLookOf(person);
  const change = () => {
    const g = nextGender(gender);
    if (isMine(person)) saveMyAvatar({ gender: g, look });
    else onChange?.({ gender: g });
  };
  return (
    <button type="button" onClick={change} aria-label={`${person?.name || 'Person'}: ${gender ? GENDER_LABEL[gender].toLowerCase() : 'gender not set'}, tap to change`}
      className={`text-xs font-medium ${gender ? 'text-ink-2' : 'text-ink-3'} hover:text-ink ${className}`}>
      {GENDER_LABEL[gender]}
    </button>
  );
}
