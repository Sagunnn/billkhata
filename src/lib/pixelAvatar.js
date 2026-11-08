// Pixel-art faces for people in splits, trips and groups: a 12×12 character drawn from the
// person's name (the same name looks the same everywhere), with hair and face styles by gender.
// `look` re-rolls it (tap the face). Pure: tests in tests/pixelAvatar.test.js.

export const GENDERS = ['', 'm', 'f']; // not set (either, by name), male, female
export const GENDER_LABEL = { '': 'Male or female?', m: 'Male', f: 'Female' };
export const nextGender = (g) => GENDERS[(GENDERS.indexOf(g || '') + 1) % GENDERS.length];

const SKIN = ['#f1c9a5', '#e0ac85', '#c98e64', '#b07650', '#8d5a3b', '#6b4329'];
const HAIR = ['#1b1512', '#2a1d16', '#3b2a1e', '#5a3b24', '#1b1512', '#2a1d16', '#7a4a26', '#8a2f3c'];
const SHIRT = ['#c0392b', '#2e5e8c', '#2f7d55', '#d08a1c', '#6a4c93', '#1f6f78', '#b5487a', '#4a5565'];
const BG = ['#fde8e4', '#e3eefb', '#e2f3e8', '#fdf0d5', '#efe7f8', '#e0f2f1', '#fbe7f0', '#eceff3'];
const CAP = ['#c0392b', '#2e5e8c', '#2f7d55', '#d08a1c', '#1b1512'];
const EYE = '#1b1512';
const MOUTH = '#9b4a3a';
const BLUSH = '#f19a9a';
const GOLD = '#e0b02e';
const FRAMES = ['#3d6fb4', '#b0413e', '#c9a227'];

/** A small fast hash of a string (FNV-1a). */
function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A seeded random number generator (mulberry32), so a name always draws the same face. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MALE_HAIR = ['short', 'spiky', 'side', 'buzz', 'cap', 'curly'];
const FEMALE_HAIR = ['long', 'bun', 'bob', 'ponytail', 'braids', 'fringe'];

/**
 * The face's pixels: { size: 12, bg, gender, hair, cells: [[x, y, colour]] } (later cells paint
 * over earlier ones). `gender` '' picks one from the name.
 */
export function avatarPixels(name = '', { gender = '', look = 0 } = {}) {
  const key = String(name || '?').trim().toLowerCase();
  const r = rng(hash(`${key}|${look || 0}`));
  const pick = (list) => list[Math.floor(r() * list.length)];
  const g = gender === 'm' || gender === 'f' ? gender : (hash(key) % 2 ? 'f' : 'm');
  const skin = pick(SKIN);
  const hairColour = pick(HAIR);
  const shirt = pick(SHIRT);
  const bg = pick(BG);
  const hair = pick(g === 'f' ? FEMALE_HAIR : MALE_HAIR);
  const cells = [];
  const px = (x, y, c) => cells.push([x, y, c]);
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(x, y, c); };

  // Hair behind the face (long styles fall past the shoulders).
  if (hair === 'long' || hair === 'braids') rect(2, 3, 9, 10, hairColour);
  if (hair === 'bob') rect(2, 3, 9, 8, hairColour);
  if (hair === 'ponytail') rect(9, 4, 10, 9, hairColour);

  // Shoulders, neck, face, ears.
  rect(1, 11, 10, 11, shirt);
  rect(2, 10, 9, 10, shirt);
  rect(5, 9, 6, 10, skin);
  rect(3, 3, 8, 8, skin);
  rect(4, 9, 7, 9, skin);
  px(2, 6, skin); px(9, 6, skin);

  // Hair on top.
  const top = () => { rect(3, 2, 8, 3, hairColour); px(3, 4, hairColour); px(8, 4, hairColour); };
  if (hair === 'short') top();
  if (hair === 'spiky') { top(); px(3, 1, hairColour); px(5, 1, hairColour); px(7, 1, hairColour); }
  if (hair === 'side') { top(); rect(2, 2, 2, 5, hairColour); rect(4, 4, 5, 4, hairColour); }
  if (hair === 'buzz') rect(3, 2, 8, 3, hairColour);
  if (hair === 'curly') { top(); rect(2, 1, 9, 2, hairColour); px(2, 3, hairColour); px(9, 3, hairColour); px(2, 4, hairColour); px(9, 4, hairColour); }
  if (hair === 'cap') { const c = pick(CAP); rect(3, 1, 8, 3, c); rect(1, 3, 5, 3, c); px(8, 4, hairColour); }
  if (hair === 'long' || hair === 'bob' || hair === 'ponytail') top();
  if (hair === 'bun') { top(); rect(5, 0, 6, 1, hairColour); px(4, 1, hairColour); px(7, 1, hairColour); }
  if (hair === 'braids') { top(); px(2, 9, GOLD); px(9, 9, GOLD); }
  if (hair === 'fringe') { top(); rect(3, 4, 8, 4, hairColour); rect(2, 3, 2, 7, hairColour); rect(9, 3, 9, 7, hairColour); }

  // Eyes, mouth, and a few extras.
  const glasses = r() < 0.2;
  if (glasses) { const f = pick(FRAMES); px(3, 6, f); px(5, 6, f); px(6, 6, f); px(8, 6, f); px(4, 5, f); px(7, 5, f); }
  px(4, 6, EYE); px(7, 6, EYE);
  const smile = r() < 0.6;
  if (smile) { px(4, 7, MOUTH); px(7, 7, MOUTH); rect(5, 8, 6, 8, MOUTH); } else rect(5, 8, 6, 8, MOUTH);
  if (g === 'm') {
    const face = r();
    if (face < 0.2) rect(4, 7, 7, 7, hairColour); // moustache
    else if (face < 0.35) { rect(3, 8, 4, 8, hairColour); rect(7, 8, 8, 8, hairColour); rect(4, 9, 7, 9, hairColour); } // beard
  } else {
    if (!smile && r() < 0.6) { px(3, 7, BLUSH); px(8, 7, BLUSH); }
    if (r() < 0.4) { px(2, 7, GOLD); px(9, 7, GOLD); } // earrings
  }
  return { size: 12, bg, gender: g, hair, cells };
}

/** The face as an SVG string (for images and the share card). */
export function avatarSvg(name, opts = {}, px = 48) {
  const { size, bg, cells } = avatarPixels(name, opts);
  const rects = cells.map(([x, y, c]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="${bg}"/>${rects}</svg>`;
}
