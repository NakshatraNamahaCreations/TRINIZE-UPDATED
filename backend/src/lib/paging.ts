import { z } from 'zod';

/* Lists that grow with the society are read a page at a time. The console sends the page number, the page
   size, the search text and the sort; the database does the searching, sorting and slicing, and only that
   page — with the total, so the pager knows how far it goes — is sent back.

   An endpoint that takes these answers in pages when `page` is given. Without it, it still returns the
   whole list, which the few callers that genuinely need every row (a dropdown of flats, a report) use. */

export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  q: z.string().trim().max(60).optional(),
  sort: z.string().trim().max(40).optional(),
});
export type Page = { page: number; limit: number };

/** the envelope every paged list comes back in */
export const paged = <T>(items: T[], total: number, p: Page) => ({ items, total, page: p.page, limit: p.limit, pages: Math.max(1, Math.ceil(total / p.limit)) });
export const offsetOf = (p: Page) => (p.page - 1) * p.limit;
/** a search term as a LIKE pattern; the wildcards a user typed are not wildcards */
export const likeOf = (q: string) => '%' + q.replace(/[%_\\]/g, '') + '%';
