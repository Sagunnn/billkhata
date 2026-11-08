// The full photo of a bill for a screen that shows it (viewer, editor, winner check): read from the
// photos store when needed, '' while loading or when there's none.
import { useEffect, useState } from 'react';
import { photoOf } from '../lib/photos.js';

export function usePhoto(e) {
  const direct = typeof e?.receiptImage === 'string' && e.receiptImage ? e.receiptImage : '';
  const [loaded, setLoaded] = useState({ key: '', src: '' });
  const key = e ? `${e.id}|${e.updatedAt || ''}|${e.hasPhoto ? 1 : 0}` : '';
  useEffect(() => {
    if (direct || !e?.hasPhoto || e.receiptImage === null) return undefined;
    let live = true;
    photoOf(e).then((src) => { if (live) setLoaded({ key, src }); });
    return () => { live = false; };
  }, [key, direct]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!e || e.receiptImage === null) return '';
  return direct || (loaded.key === key ? loaded.src : '');
}
