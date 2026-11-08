// A bill's full photo, wherever it is: on the bill itself (a new photo not saved yet, a draft, a
// backup) or in the photos store (saved bills; see db.js). Lists use the small `thumb` instead.
import { getPhoto } from './db.js';

/** The full photo (data URL) of a bill, or '' when it has none. */
export async function photoOf(e) {
  if (!e) return '';
  if (typeof e.receiptImage === 'string' && e.receiptImage) return e.receiptImage;
  if (e.receiptImage === null || !e.hasPhoto) return '';
  return getPhoto(e.id);
}

/** Bills with their full photos put back on (for a backup file or a PDF), one at a time. */
export async function withPhotos(list) {
  const out = [];
  for (const e of list) {
    if (!e.hasPhoto || e.receiptImage) { out.push(e); continue; }
    const photo = await getPhoto(e.id);
    out.push(photo ? { ...e, receiptImage: photo } : { ...e, hasPhoto: false }); // gone: say so
  }
  return out;
}
