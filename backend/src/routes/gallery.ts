import { access, unlink } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import { galleryAlbums, galleryPhotos, type StaffRole } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { residentOf, staffOf, userIdFrom } from '../lib/auth.js';
import { notify, residentsOf } from '../lib/community.js';
import { badRequest, conflict, notFound, parse } from '../lib/http.js';

const Aid = z.object({ aid: z.uuid() });
const AidId = Aid.extend({ id: z.uuid() });
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Give the date as YYYY-MM-DD');
const MAX_PHOTOS = 200;
const WRITERS: StaffRole[] = ['admin', 'committee', 'operator'];

/**
 * Community moments.
 *   /v1/admin/:aid/gallery…   the society office creates albums and adds the photos (uploaded through /v1/uploads)
 *   /v1/gallery               residents see the albums that are published and have photos in them
 */
export const galleryRoutes = ({ config, db }: Deps): FastifyPluginAsync => async app => {
  const staff = async (req: FastifyRequest, roles: StaffRole[] = ['admin', 'committee', 'moderator', 'auditor', 'operator']) => {
    const { aid } = parse(Aid, req.params);
    return { aid, s: await staffOf(db, await userIdFrom(req, config.JWT_SECRET), aid, roles) };
  };

  /** Only files this server stored are accepted; what is kept is the path, so it works whatever address the server is reached at. */
  const pathOf = (url: string) => {
    const m = /\/files\/([0-9a-f-]{36}\.(?:jpg|png|webp|heic))$/i.exec(url);
    if (!m) throw badRequest('not_an_upload', 'Upload the photo first, then add it to the album.');
    return '/files/' + m[1];
  };
  const forget = (paths: string[]) => Promise.all(paths.map(p => unlink(join(resolve(config.UPLOAD_DIR), basename(p))).catch(() => { /* already gone */ })));

  type Album = typeof galleryAlbums.$inferSelect;
  const withPhotos = async (albums: Album[]) => {
    const photos = albums.length ? await db.select().from(galleryPhotos).where(inArray(galleryPhotos.albumId, albums.map(a => a.id))).orderBy(asc(galleryPhotos.position), asc(galleryPhotos.createdAt)) : [];
    return albums.map(a => {
      const mine = photos.filter(p => p.albumId === a.id).map(p => ({ id: p.id, path: p.path, caption: p.caption }));
      const cover = mine.find(p => p.id === a.coverPhotoId) ?? mine[0] ?? null;
      return { id: a.id, title: a.title, description: a.description, eventDate: a.eventDate, published: a.published, createdBy: a.createdBy, createdAt: a.createdAt, count: mine.length, cover: cover?.path ?? null, coverPhotoId: cover?.id ?? null, photos: mine };
    });
  };
  const albumOf = async (aid: string, id: string) => {
    const [a] = await db.select().from(galleryAlbums).where(and(eq(galleryAlbums.id, id), eq(galleryAlbums.associationId, aid)));
    if (!a) throw notFound('Album');
    return a;
  };
  /** tell residents the first time an album can actually be seen with photos in it */
  const announce = async (a: Album) => {
    if (a.notifiedAt || !a.published) return;
    const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(galleryPhotos).where(eq(galleryPhotos.albumId, a.id))) as [{ n: number }];
    if (!n) return;
    await db.update(galleryAlbums).set({ notifiedAt: new Date() }).where(eq(galleryAlbums.id, a.id));
    await notify(db, await residentsOf(db, a.associationId), { kind: 'events', title: 'New photos: ' + a.title, body: `${n} photo${n === 1 ? '' : 's'} shared by the society office`, href: '/gallery?album=' + a.id });
  };
  const addPhotos = async (album: Album, urls: string[]) => {
    const paths = [...new Set(urls.map(pathOf))];
    for (const p of paths) await access(join(resolve(config.UPLOAD_DIR), basename(p))).catch(() => { throw badRequest('not_an_upload', 'One of the photos could not be found. Upload it again.'); });
    const have = await db.select({ path: galleryPhotos.path, position: galleryPhotos.position }).from(galleryPhotos).where(eq(galleryPhotos.albumId, album.id));
    const fresh = paths.filter(p => !have.some(h => h.path === p));
    if (have.length + fresh.length > MAX_PHOTOS) throw conflict('album_full', `An album holds up to ${MAX_PHOTOS} photos. This one has ${have.length}.`);
    const from = have.reduce((m, h) => Math.max(m, h.position), -1) + 1;
    if (fresh.length) await db.insert(galleryPhotos).values(fresh.map((path, i) => ({ albumId: album.id, path, position: from + i })));
    return fresh.length;
  };

  /* ---------- the society office ---------- */
  app.get('/admin/:aid/gallery', async req => {
    const { aid } = await staff(req);
    return withPhotos(await db.select().from(galleryAlbums).where(eq(galleryAlbums.associationId, aid)).orderBy(desc(galleryAlbums.eventDate), desc(galleryAlbums.createdAt)));
  });

  app.post('/admin/:aid/gallery', async (req, reply) => {
    const { aid, s } = await staff(req, WRITERS);
    const b = parse(z.object({
      title: z.string().trim().min(3, 'Give the album a name').max(60), description: z.string().trim().max(300).default(''), eventDate: Day,
      published: z.boolean().default(true), photos: z.array(z.string().max(300)).max(30).default([]),
    }), req.body);
    const [a] = await db.insert(galleryAlbums).values({ associationId: aid, title: b.title, description: b.description, eventDate: b.eventDate, published: b.published, createdBy: s.name }).returning();
    await addPhotos(a!, b.photos);
    await announce(a!);
    await audit(db, aid, s.userId, s.name, `album created · ${b.title} · ${b.photos.length} photo${b.photos.length === 1 ? '' : 's'}`);
    return reply.status(201).send((await withPhotos([a!]))[0]);
  });

  /** rename an album, change its date, hide or show it, or choose its cover photo */
  app.put('/admin/:aid/gallery/:id', async req => {
    const { aid, s } = await staff(req, WRITERS);
    const { id } = parse(AidId, req.params);
    const b = parse(z.object({ title: z.string().trim().min(3).max(60), description: z.string().trim().max(300), eventDate: Day, published: z.boolean(), coverPhotoId: z.uuid() }).partial(), req.body);
    const was = await albumOf(aid, id);
    if (!Object.keys(b).length) throw conflict('nothing_to_change', 'Nothing was changed.');
    if (b.coverPhotoId) {
      const [p] = await db.select({ id: galleryPhotos.id }).from(galleryPhotos).where(and(eq(galleryPhotos.id, b.coverPhotoId), eq(galleryPhotos.albumId, id)));
      if (!p) throw notFound('That photo');
    }
    const [now] = await db.update(galleryAlbums).set(b).where(eq(galleryAlbums.id, id)).returning();
    await announce(now!);
    await audit(db, aid, s.userId, s.name, `album edited · ${now!.title}${b.published !== undefined && b.published !== was.published ? (b.published ? ' · shown in the app' : ' · hidden from the app') : ''}`);
    return (await withPhotos([now!]))[0];
  });

  app.delete('/admin/:aid/gallery/:id', async (req, reply) => {
    const { aid, s } = await staff(req, WRITERS);
    const { id } = parse(AidId, req.params);
    const a = await albumOf(aid, id);
    const photos = await db.select({ path: galleryPhotos.path }).from(galleryPhotos).where(eq(galleryPhotos.albumId, id));
    await db.delete(galleryAlbums).where(eq(galleryAlbums.id, id));
    await forget(photos.map(p => p.path));
    await audit(db, aid, s.userId, s.name, `album deleted · ${a.title} · ${photos.length} photo${photos.length === 1 ? '' : 's'}`);
    return reply.status(204).send();
  });

  /** add photos already uploaded through /v1/uploads */
  app.post('/admin/:aid/gallery/:id/photos', async req => {
    const { aid, s } = await staff(req, WRITERS);
    const { id } = parse(AidId, req.params);
    const { photos } = parse(z.object({ photos: z.array(z.string().max(300)).min(1).max(30) }), req.body);
    const a = await albumOf(aid, id);
    const added = await addPhotos(a, photos);
    await announce(a);
    if (added) await audit(db, aid, s.userId, s.name, `${added} photo${added === 1 ? '' : 's'} added · ${a.title}`);
    return (await withPhotos([a]))[0];
  });

  app.put('/admin/:aid/gallery/:id/photos/:photoId', async req => {
    const { aid } = await staff(req, WRITERS);
    const { id, photoId } = parse(AidId.extend({ photoId: z.uuid() }), req.params);
    const { caption } = parse(z.object({ caption: z.string().trim().max(120) }), req.body);
    const a = await albumOf(aid, id);
    const done = await db.update(galleryPhotos).set({ caption }).where(and(eq(galleryPhotos.id, photoId), eq(galleryPhotos.albumId, id))).returning();
    if (!done.length) throw notFound('That photo');
    return (await withPhotos([a]))[0];
  });

  app.delete('/admin/:aid/gallery/:id/photos/:photoId', async req => {
    const { aid, s } = await staff(req, WRITERS);
    const { id, photoId } = parse(AidId.extend({ photoId: z.uuid() }), req.params);
    const a = await albumOf(aid, id);
    const gone = await db.delete(galleryPhotos).where(and(eq(galleryPhotos.id, photoId), eq(galleryPhotos.albumId, id))).returning();
    if (!gone.length) throw notFound('That photo');
    if (a.coverPhotoId === photoId) await db.update(galleryAlbums).set({ coverPhotoId: null }).where(eq(galleryAlbums.id, id));
    await forget(gone.map(p => p.path));
    await audit(db, aid, s.userId, s.name, `photo removed · ${a.title}`);
    return (await withPhotos([{ ...a, coverPhotoId: a.coverPhotoId === photoId ? null : a.coverPhotoId }]))[0];
  });

  /* ---------- residents ---------- */
  app.get('/gallery', async req => {
    const r = await residentOf(db, await userIdFrom(req, config.JWT_SECRET));
    const albums = await db.select().from(galleryAlbums).where(and(eq(galleryAlbums.associationId, r.associationId), eq(galleryAlbums.published, true))).orderBy(desc(galleryAlbums.eventDate), desc(galleryAlbums.createdAt)).limit(60);
    return (await withPhotos(albums)).filter(a => a.count > 0).map(({ published: _p, createdBy: _b, createdAt: _c, coverPhotoId: _i, ...a }) => a);
  });
};
