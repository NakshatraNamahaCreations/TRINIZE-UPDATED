import { Lifebuoy, LockKey, Warning } from '@phosphor-icons/react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { api, LIVE } from './api';
import { association } from './live';

/* The society's subscription, as its console sees it: which plan it is on, and which sections that
   plan includes. Trinize decides this in the Owner Portal; the server enforces it on every request,
   and this file only makes the console say so plainly instead of showing errors. */

export type Feature = 'accounting' | 'owners' | 'workorders' | 'gate' | 'reports' | 'leasing' | 'workflows' | 'inspections' | 'assistant';
export type Plan = {
  plan: string | null; state: string | null; suspended: boolean; renewsAt: string | null;
  features: Record<Feature, boolean>; needs: Partial<Record<Feature, string>>; names: Record<Feature, string>;
  plans: { name: string; tag: string; about: string; price: number }[];
};

/** which part of the plan each page needs: `whole` closes the page, `part` only some of what is on it */
const SECTIONS: Record<string, { whole?: Feature; part?: Feature[] }> = {
  '/assistant': { whole: 'assistant' }, '/inspections': { whole: 'inspections' },
  '/maintenance': { whole: 'workorders' }, '/gate': { whole: 'gate' }, '/owners': { whole: 'owners' },
  '/accounts': { part: ['accounting'] },
};
const sectionOf = (path: string) => Object.entries(SECTIONS).find(([to]) => path.startsWith(to))?.[1];

const Ctx = createContext<{ plan: Plan | null; /** false only while the first answer is on its way */ settled: boolean; reload: () => void }>({ plan: null, settled: true, reload: () => {} });
export const usePlan = () => useContext(Ctx);
/** true when the signed-in society's plan does not include the page at `to` */
export const isLocked = (plan: Plan | null, to: string) => { const s = sectionOf(to); return !!(plan && s?.whole && !plan.features[s.whole]); };

export function PlanProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const signedIn = !!user;
  const [plan, setPlan] = useState<Plan | null>(null);
  const [settled, setSettled] = useState(!LIVE);
  const reload = useCallback(() => {
    if (!LIVE || !association()) return;
    api<Plan>('GET', `/v1/admin/${association()}/plan`).then(setPlan).catch(() => { /* the console keeps working; the server still enforces the plan */ }).finally(() => setSettled(true));
  }, []);
  useEffect(() => {
    if (!LIVE || !signedIn) return;
    const tick = () => { if (document.visibilityState === 'visible') reload(); };
    tick();
    // Trinize can change the plan at any time; pick it up without a reload
    const h = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(h); document.removeEventListener('visibilitychange', tick); };
  }, [signedIn, reload]);
  const value = useMemo(() => ({ plan: signedIn ? plan : null, settled, reload }), [plan, signedIn, settled, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

function Notice({ icon, tone, title, children }: { icon: ReactNode; tone: 'warn' | 'bad'; title: string; children: ReactNode }) {
  return (
    <div className={'plan-wall ' + tone}>
      <div className="pw-ic">{icon}</div>
      <h1>{title}</h1>
      {children}
    </div>
  );
}

/** Stands in for the page: the whole console when the subscription is suspended, one section when the plan does not include it. */
export function PlanGate() {
  const { plan, settled } = usePlan();
  const { pathname } = useLocation();
  // wait for the plan before drawing a page, so a locked section never starts loading and then vanishes
  if (!settled) return null;
  if (!plan) return <Outlet />;
  const onSupport = pathname.startsWith('/support');

  if (plan.suspended && !onSupport) {
    return (
      <Notice tone="bad" icon={<Warning size={26} weight="fill" />} title="This society’s subscription is suspended">
        <p>The console is closed until the subscription is restored. Nothing has been deleted — your flats, residents, bills and records are all kept, and open again as soon as Trinize reactivates the account.</p>
        <p>This usually means a subscription invoice is unpaid. Write to Trinize and they will tell you what is outstanding.</p>
        <div className="pw-act"><Link className="a-btn" to="/support"><Lifebuoy size={15} />Write to Trinize support</Link></div>
      </Notice>
    );
  }

  const sec = sectionOf(pathname);
  if (sec?.whole && !plan.features[sec.whole]) {
    const need = plan.needs[sec.whole] ?? 'a higher', info = plan.plans.find(p => p.name === need);
    return (
      <Notice tone="warn" icon={<LockKey size={26} weight="fill" />} title={`${plan.names[sec.whole]} is part of the ${need} plan`}>
        <p>Your society is on the <b>{plan.plan}</b> plan, which does not include this section. Anything you recorded here earlier is kept and comes back when the plan is upgraded.</p>
        {info && <div className="pw-plan"><b>{info.name}</b> — {info.tag}<span>{info.about}</span></div>}
        <div className="pw-act"><Link className="a-btn" to={`/support?new=upgrade&to=${encodeURIComponent(need)}`}><Lifebuoy size={15} />Ask Trinize to upgrade</Link><Link className="a-btn ghost" to="/dashboard">Back to the dashboard</Link></div>
      </Notice>
    );
  }

  const missing = (sec?.part ?? []).filter(f => !plan.features[f]);
  return (
    <>
      {missing.length > 0 && (
        <div className="plan-strip">
          <LockKey size={16} weight="fill" />
          <span><b>{missing.map(f => plan.names[f]).join(', ')}</b> {missing.length === 1 ? 'is' : 'are'} part of the {plan.needs[missing[0]!]} plan. Your society is on {plan.plan}, so those tabs on this page are locked.</span>
          <Link to={`/support?new=upgrade&to=${encodeURIComponent(plan.needs[missing[0]!] ?? '')}`}>Ask to upgrade</Link>
        </div>
      )}
      <Outlet />
    </>
  );
}

/** The plan line under the society's name in the sidebar. */
export function planLine(plan: Plan | null) {
  if (!plan?.plan) return null;
  if (plan.suspended) return 'Subscription suspended';
  return `${plan.plan} plan${plan.state === 'Trial' && plan.renewsAt ? ' · trial to ' + day(plan.renewsAt) : ''}`;
}
