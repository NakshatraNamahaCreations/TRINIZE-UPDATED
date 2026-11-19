import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO } from '../src/db/seed.js';
import { testApp } from './helpers.js';

let t: Awaited<ReturnType<typeof testApp>>;
let admin: string, resident: string;
beforeAll(async () => {
  t = await testApp();
  admin = (await t.staffIn()).accessToken;
  resident = (await t.signIn(DEMO.residentPhone)).accessToken;
  mkdirSync('uploads-test', { recursive: true });
});
afterAll(() => t.close());

const A = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) => t.call(method, `/v1/admin/${t.associationId}/gallery${path}`, { token: admin, body });
/** a stored photo, as /v1/uploads would have left it */
const photo = () => { const name = randomUUID() + '.jpg'; writeFileSync('uploads-test/' + name, Buffer.from([0xff, 0xd8, 0xff, 0xe0])); return { url: 'http://api.test/files/' + name, path: '/files/' + name, file: 'uploads-test/' + name }; };
const seen = async () => (await t.call('GET', '/v1/gallery', { token: resident })).body as { id: string; title: string; count: number; cover: string; photos: { id: string; path: string; caption: string }[] }[];
const told = async () => (await t.call('GET', '/v1/notifications', { token: resident })).body.filter((n: { title: string }) => n.title.startsWith('New photos')).length;

describe('community moments', () => {
  it('shows residents an album once it has photos, and tells them once', async () => {
    expect(await seen()).toEqual([]);
    const made = await A('POST', '', { title: 'Diwali evening', description: 'At the clubhouse lawn', eventDate: '2026-11-08' });
    expect(made.status).toBe(201);
    // an empty album is not shown and nobody is told
    expect(await seen()).toEqual([]);
    expect(await told()).toBe(0);

    const [a, b, c] = [photo(), photo(), photo()];
    const added = await A('POST', `/${made.body.id}/photos`, { photos: [a.url, b.url, a.url] });
    expect(added.body.count).toBe(2); // the same photo twice is kept once
    const [album] = await seen();
    expect(album).toMatchObject({ title: 'Diwali evening', count: 2, cover: a.path });
    expect(album!.photos.map(p => p.path)).toEqual([a.path, b.path]);
    expect(await told()).toBe(1);
    await A('POST', `/${made.body.id}/photos`, { photos: [c.url] });
    expect(await told()).toBe(1);

    // a caption and a different cover
    const third = (await seen())[0]!.photos[2]!;
    expect((await A('PUT', `/${made.body.id}/photos/${third.id}`, { caption: 'Rangoli by Tower 4' })).status).toBe(200);
    expect((await A('PUT', `/${made.body.id}`, { coverPhotoId: third.id, title: 'Diwali evening 2026' })).body.cover).toBe(c.path);
    expect((await seen())[0]).toMatchObject({ title: 'Diwali evening 2026', cover: c.path });
    expect((await seen())[0]!.photos[2]!.caption).toBe('Rangoli by Tower 4');
  });

  it('accepts only photos this server stored', async () => {
    const id = (await A('GET', '')).body[0].id;
    expect((await A('POST', `/${id}/photos`, { photos: ['https://example.com/cat.jpg'] })).body.error.code).toBe('not_an_upload');
    expect((await A('POST', `/${id}/photos`, { photos: [`http://api.test/files/${randomUUID()}.jpg`] })).body.error.code).toBe('not_an_upload');
    expect((await A('POST', `/${id}/photos`, { photos: ['http://api.test/files/../../.env'] })).body.error.code).toBe('not_an_upload');
  });

  it('hides an album, removes a photo with its file, and deletes an album with everything in it', async () => {
    const list = (await A('GET', '')).body;
    const id = list[0].id, cover = list[0].photos.find((p: { id: string }) => p.id === list[0].coverPhotoId);
    // hidden: the office still has it, residents do not
    await A('PUT', `/${id}`, { published: false });
    expect(await seen()).toEqual([]);
    expect((await A('GET', '')).body[0].published).toBe(false);
    await A('PUT', `/${id}`, { published: true });

    // removing the cover photo falls back to the first one, and the file goes too
    const file = 'uploads-test/' + cover.path.split('/').pop();
    expect(existsSync(file)).toBe(true);
    const after = await A('DELETE', `/${id}/photos/${cover.id}`);
    expect(after.body.count).toBe(2);
    expect(after.body.cover).toBe(after.body.photos[0].path);
    expect(existsSync(file)).toBe(false);

    const left = after.body.photos.map((p: { path: string }) => 'uploads-test/' + p.path.split('/').pop());
    expect((await A('DELETE', `/${id}`)).status).toBe(204);
    expect(left.some((f: string) => existsSync(f))).toBe(false);
    expect(await seen()).toEqual([]);
    expect((await A('GET', '/audit'.replace('/audit', ''))).body).toEqual([]);
  });

  it('lists newest event first and keeps residents and other societies out', async () => {
    const p1 = photo(), p2 = photo();
    await A('POST', '', { title: 'Plantation drive', eventDate: '2026-09-02', photos: [p1.url] });
    await A('POST', '', { title: 'Onam celebration', eventDate: '2026-10-14', photos: [p2.url] });
    await A('POST', '', { title: 'Draft album', eventDate: '2026-11-01', published: false, photos: [photo().url] });
    expect((await seen()).map(a => a.title)).toEqual(['Onam celebration', 'Plantation drive']);
    expect((await A('GET', '')).body.map((a: { title: string }) => a.title)).toEqual(['Draft album', 'Onam celebration', 'Plantation drive']);
    // a resident cannot manage albums; a resident of another society sees none of these
    expect((await t.call('POST', `/v1/admin/${t.associationId}/gallery`, { token: resident, body: { title: 'Mine', eventDate: '2026-11-01' } })).status).toBe(403);
    expect((await t.call('GET', `/v1/admin/${t.greenMeadows}/gallery`, { token: admin })).status).toBe(403);
    expect((await A('POST', '', { title: 'x', eventDate: 'yesterday' })).status).toBe(400);
  });
});
