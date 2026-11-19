import { useFocusEffect } from '@/lib/refresh';
import { useCallback, useState } from 'react';
import type { IconName } from '@/components/Icon';
import { MOMENTS } from '@/components/moments';
import type { Key } from '@/i18n';
import { api, API_URL, LIVE } from './api';

/* Community moments: the photo albums the society office shares. Connected, they come from the
   server (the office adds them in its console, under Gallery). In the demo they are illustrated samples. */

export type GalleryPhoto = { id: string; uri: string | null; caption: string };
export type GalleryAlbum = {
  id: string;
  /** the office's own name for the album; demo albums carry a translation key instead */
  title: string; titleKey?: Key;
  description: string; eventDate: string | null; count: number; cover: string | null; photos: GalleryPhoto[];
  /** how a demo album is drawn, since it has no real photos */
  art?: { ic: IconName; g: readonly [string, string]; fg: string };
};

type ApiAlbum = { id: string; title: string; description: string; eventDate: string; count: number; cover: string | null; photos: { id: string; path: string; caption: string }[] };
/** the server keeps a path; this phone reaches the server at its own address */
const uri = (path: string) => (/^https?:\/\//.test(path) ? path : API_URL + path);

const DEMO: GalleryAlbum[] = MOMENTS.map(m => ({
  id: m.id, title: '', titleKey: m.l, description: '', eventDate: null, count: m.count, cover: null,
  photos: Array.from({ length: m.count }, (_, i) => ({ id: `${m.id}-${i}`, uri: null, caption: '' })),
  art: { ic: m.ic, g: m.g, fg: m.fg },
}));

export async function fetchAlbums(): Promise<GalleryAlbum[]> {
  if (!LIVE) return DEMO;
  return (await api<ApiAlbum[]>('GET', '/v1/gallery')).map(a => ({
    id: a.id, title: a.title, description: a.description, eventDate: a.eventDate, count: a.count, cover: a.cover ? uri(a.cover) : null,
    photos: a.photos.map(p => ({ id: p.id, uri: uri(p.path), caption: p.caption })),
  }));
}

/** The albums, read again each time the screen comes back into view. `ready` is false until the first answer. */
export function useAlbums() {
  const [albums, setAlbums] = useState<GalleryAlbum[]>(LIVE ? [] : DEMO);
  const [ready, setReady] = useState(!LIVE);
  useFocusEffect(useCallback(() => {
    let on = true;
    // a failed read keeps whatever was shown before
    fetchAlbums().then(a => { if (on) setAlbums(a); }).catch(() => {}).finally(() => { if (on) setReady(true); });
    return () => { on = false; };
  }, []));
  return { albums, ready };
}
