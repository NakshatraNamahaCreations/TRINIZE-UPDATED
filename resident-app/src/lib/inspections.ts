import { api } from './api';
import { uploadPhoto } from './live';

/* Inspections. The property manager walks a checklist on the phone (the /v1/admin/:aid routes);
   a resident or owner reads the reports shared with them and can acknowledge one. */

export const CONDITIONS = ['Good', 'Fair', 'Poor', 'Damaged', 'Missing'] as const;
export type Condition = (typeof CONDITIONS)[number];
export type Counts = { total: number; rated: number; Good: number; Fair: number; Poor: number; Damaged: number; Missing: number; findings: number; critical: number; high: number; workOrders: number };
export type Head = {
  id: string; ref: string; type: string; template: string; scope: 'unit' | 'common'; where: string; unit: string | null; status: 'In progress' | 'Submitted'; inspector: string;
  startedAt: string; submittedAt: string | null; counts: Counts; shareOwner: boolean; shareTenant: boolean; ack: { name: string; role: string; note: string; at: string } | null;
};
export type Item = {
  id: string; item: string; photoRequired: boolean; condition: Condition | null; note: string; photos: string[]; checkedAt: string | null;
  finding: string; severity: 'Low' | 'Medium' | 'High' | 'Critical' | null; recommendation: string | null; category: string | null; findingBy: 'ai' | 'rules' | null;
  workOrder: { ref: string; status: string; vendor: string | null; costEstimate?: number | null; approval?: string } | null;
};
export type Change = { section: string; item: string; before: Condition; after: Condition; worse: boolean; beforePhoto: string | null; afterPhoto: string | null };
export type Full = Head & {
  summary: string; summaryBy: 'ai' | 'rules' | null; sections: { name: string; items: Item[] }[]; missing?: string[];
  comparison: { ref: string; date: string; worse: number; better: number; changes: Change[] } | null;
};
export type Template = { key: string; name: string; about: string; scope: 'unit' | 'common'; builtIn: boolean; sections: { name: string; items: { name: string; photo: boolean }[] }[] };
export type Options = { types: string[]; templates: Template[]; units: { id: string; code: string; label: string }[]; aiConnected: boolean };

const A = (aid: string) => `/v1/admin/${aid}/inspections`;

/* the property manager */
export const options = (aid: string) => api<Options>('GET', `${A(aid)}/options`);
export const list = (aid: string) => api<Head[]>('GET', A(aid));
export const one = (aid: string, id: string) => api<Full>('GET', `${A(aid)}/${id}`);
export const begin = (aid: string, o: { type: string; template: string; unitId?: string; place?: string }) => api<Full>('POST', A(aid), o);
export const rate = (aid: string, id: string, item: string, patch: { condition?: Condition; note?: string; photos?: string[] }) => api<Full>('PUT', `${A(aid)}/${id}/items/${item}`, patch);
/** a photo taken on the phone is uploaded first; the item then keeps its address */
export async function addPhoto(aid: string, id: string, item: Item, uri: string) {
  return rate(aid, id, item.id, { photos: [...item.photos, await uploadPhoto(uri)] });
}
export const analyse = (aid: string, id: string) => api<Full>('POST', `${A(aid)}/${id}/analyse`);
export const submit = (aid: string, id: string) => api<Full>('POST', `${A(aid)}/${id}/submit`);
export const share = (aid: string, id: string, owner: boolean, tenant: boolean) => api<Full>('PUT', `${A(aid)}/${id}/share`, { owner, tenant });
export const raise = (aid: string, id: string, itemIds: string[]) => api<{ created: string[]; inspection: Full }>('POST', `${A(aid)}/${id}/work-orders`, { items: itemIds.map(x => ({ id: x })) });

/* the resident or owner */
export const myReports = () => api<Head[]>('GET', '/v1/inspections');
export const myReport = (id: string) => api<Full>('GET', `/v1/inspections/${id}`);
export const acknowledge = (id: string, note: string) => api<Full>('POST', `/v1/inspections/${id}/ack`, { note });

export const COND_TONE = { Good: 'good', Fair: 'warn', Poor: 'bad', Damaged: 'bad', Missing: 'bad' } as const;
export const SEV_TONE = { Low: 'dim', Medium: 'warn', High: 'bad', Critical: 'bad' } as const;
export const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
