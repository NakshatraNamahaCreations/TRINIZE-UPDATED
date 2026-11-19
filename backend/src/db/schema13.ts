import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { associations } from './schema.js';

/* Community moments: photo albums the society office shares with its residents. */

export const galleryAlbums = pgTable('gallery_albums', {
  id: uuid('id').primaryKey().defaultRandom(),
  associationId: uuid('association_id').notNull().references(() => associations.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  /** the day the photos were taken, as YYYY-MM-DD; albums are listed newest first by it */
  eventDate: text('event_date').notNull(),
  /** a hidden album stays in the console and is not shown in the app */
  published: boolean('published').notNull().default(true),
  /** the photo shown on the album's card; null means the first one */
  coverPhotoId: uuid('cover_photo_id'),
  /** residents are told about an album once, the first time it is visible with photos in it */
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
  createdBy: text('created_by').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => [index().on(t.associationId, t.eventDate)]);

export const galleryPhotos = pgTable('gallery_photos', {
  id: uuid('id').primaryKey().defaultRandom(),
  albumId: uuid('album_id').notNull().references(() => galleryAlbums.id, { onDelete: 'cascade' }),
  /** where the file is served from on this server, e.g. /files/<name>.jpg — each app puts its own server address in front */
  path: text('path').notNull(),
  caption: text('caption').notNull().default(''),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => [index().on(t.albumId, t.position)]);
