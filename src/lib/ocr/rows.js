// OCR boxes → clean words → text rows. Pure functions, unit-tested in tests/rows.test.js.
//
// PaddleOCR returns one box per run of text ("Chicken Keema Noodles", "1 250.00 250.00"), each with
// a confidence (0-100 here). On a handheld receipt the label on the left ("Total") and its amount on
// the right sit at slightly different heights, so rows are clustered by vertical centre with a
// tolerance of 0.7 × the text height (boxes are trimmed to their ink, so that's the real height;
// the next printed line is at least ~1.2 × away), then read left to right.

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const cy = (b) => (b.y0 + b.y1) / 2;

// The multilingual model knows CJK, so dashed and "=====" separator lines come out as 一, 三, 二,
// and a full stop as 。. Nepali bills never print CJK, so those characters are noise.
const CJK = /[⺀-⿿　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-､]/g;

/**
 * Drops noise: CJK characters, boxes that are only rule lines ("----==-"), and low-confidence
 * boxes. A low-confidence box that is plainly a number (an amount next to a table line) is kept.
 */
export function cleanBoxes(boxes = [], { minConfidence = 45 } = {}) {
  const out = [];
  for (const b of boxes) {
    const text = String(b.text || '').replace(CJK, ' ').replace(/\s+/g, ' ').trim();
    if (!text || !/[\p{L}\p{N}]/u.test(text)) continue;
    // A rule line that picked up a stray letter or two: "--=-==-T", "====E".
    if (/[-=_~—–]{4,}/.test(text) && text.replace(/[-=_~—–\s]/g, '').length <= 2) continue;
    const numeric = /\d/.test(text) && /^[\d.,:/\-\s]+$/.test(text);
    if ((b.confidence ?? 100) < minConfidence && !(numeric && (b.confidence ?? 100) >= 30)) continue;
    // Removing noise characters can change the word count; then the measured parts no longer fit.
    const parts = b.parts && b.parts.length === text.split(' ').length ? b.parts : undefined;
    out.push({ ...b, text, parts });
  }
  return out;
}

/**
 * Where each word of a box really is, from the ink: `profile` counts ink pixels per column of the
 * box. Runs of ink separated by blank gaps are joined (smallest gaps first) until there is one run
 * per word. Null when the ink can't account for every word (then words share the width by length).
 * @returns {{ x0: number, x1: number }[] | null} offsets from the box's left edge
 */
export function splitByInk(profile = [], wordCount = 1) {
  const spans = [];
  let start = -1;
  for (let x = 0; x <= profile.length; x++) {
    const ink = x < profile.length && profile[x] > 0;
    if (ink && start < 0) start = x;
    else if (!ink && start >= 0) { spans.push({ x0: start, x1: x }); start = -1; }
  }
  if (spans.length < wordCount || wordCount < 1) return null;
  while (spans.length > wordCount) {
    let at = 1;
    for (let i = 2; i < spans.length; i++) if (spans[i].x0 - spans[i - 1].x1 < spans[at].x0 - spans[at - 1].x1) at = i;
    spans[at - 1] = { x0: spans[at - 1].x0, x1: spans[at].x1 };
    spans.splice(at, 1);
  }
  return spans;
}

/**
 * One box per word, for column positions. Boxes from the worker carry `parts` (word positions
 * measured from the ink); otherwise the box's width is shared out by character count.
 */
export function splitWords(boxes = []) {
  const out = [];
  for (const b of boxes) {
    const text = String(b.text || '');
    const tokens = [...text.matchAll(/\S+/g)];
    if (b.parts?.length === tokens.length) {
      tokens.forEach((m, i) => out.push({ ...b, parts: undefined, text: m[0], x0: b.x0 + b.parts[i].x0, x1: b.x0 + b.parts[i].x1 }));
      continue;
    }
    const per = (b.x1 - b.x0) / Math.max(1, text.length);
    for (const m of tokens) {
      out.push({ ...b, parts: undefined, text: m[0], x0: b.x0 + m.index * per, x1: b.x0 + (m.index + m[0].length) * per });
    }
  }
  return out;
}

/**
 * Boxes into rows: same row when vertical centres are within `tol` × the median box height of the
 * row's running centre. Rows top to bottom, boxes left to right.
 * @returns {{ cy: number, boxes: object[], text: string }[]}
 */
export function buildRows(boxes = [], { tol = 0.7 } = {}) {
  const h = median(boxes.map((b) => b.y1 - b.y0)) || 20;
  const rows = [];
  for (const b of [...boxes].sort((x, y) => cy(x) - cy(y))) {
    const c = cy(b);
    let best = null;
    for (const r of rows) {
      const d = Math.abs(r.cy - c);
      if (d <= h * tol && (!best || d < Math.abs(best.cy - c))) best = r;
    }
    if (best) {
      best.boxes.push(b);
      best.cy = best.boxes.reduce((s, x) => s + cy(x), 0) / best.boxes.length;
    } else rows.push({ cy: c, boxes: [b] });
  }
  for (const r of rows) {
    r.boxes.sort((a, b) => a.x0 - b.x0);
    // A wide gap between boxes (label … amount) keeps a few spaces, as a printed receipt reads.
    r.text = r.boxes.reduce((s, b, i) => {
      if (!i) return b.text;
      const gap = b.x0 - r.boxes[i - 1].x1;
      return `${s}${gap > h * 1.5 ? '   ' : ' '}${b.text}`;
    }, '');
  }
  return rows.sort((a, b) => a.cy - b.cy);
}

/** The text of an OCR read, one line per row. */
export const rowsText = (boxes, opts) => buildRows(boxes, opts).map((r) => r.text).join('\n');
