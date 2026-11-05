import { CalendarBlank, CalendarCheck, ChartBar, Hourglass, Plus } from '@phosphor-icons/react';
import { IconTile, PageHead, PanelHead, Pill } from '../components/ui';
import { useToast } from '../components/toast-context';
import { useStore } from '../store/context';

export function EventsPolls() {
  const { state } = useStore();
  const toast = useToast();

  return (
    <>
      <PageHead title="Events & polls" sub="Tallies update live as residents RSVP and vote. One vote per unit and capacity limits are enforced by the system, not the UI." />
      <div className="grid2">
        <div className="panel">
          <PanelHead icon={CalendarCheck} title="Events" sub="RSVP & capacity" tone="good" />
          {state.events.map(e => {
            const pct = Math.min(100, Math.round((e.going / e.cap) * 100));
            return (
              <div key={e.id} style={{ margin: '12px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
                  <b style={{ display: 'flex', alignItems: 'center', gap: 8 }}><IconTile icon={pct >= 100 ? Hourglass : CalendarBlank} tone={pct >= 95 ? 'warn' : 'acc'} size={28} />{e.title}</b>
                  <span className="num" style={{ color: 'var(--ink2)' }}>{e.going} / {e.cap}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink3)', margin: '2px 0 5px' }}>{e.when} · {e.where}</div>
                <div className="prog"><i style={{ width: pct + '%', background: pct >= 95 ? 'var(--warn)' : 'var(--acc)' }} /></div>
              </div>
            );
          })}
          <button className="a-btn ghost" style={{ marginTop: 6 }} onClick={() => toast('Coming in the real build', 'Create event, set capacity, eligibility and reminders.')}>
            <Plus size={14} />Create event
          </button>
        </div>
        <div className="panel">
          <PanelHead icon={ChartBar} title="Polls" sub="Results reconcile with resident votes" />
          {state.polls.map(p => {
            const total = p.opts.reduce((a, o) => a + o.v, 0);
            return (
              <div key={p.id} style={{ margin: '12px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
                  <b>{p.q}</b>
                  <Pill tone={p.closed ? 'dim' : 'good'}>{p.closed ? 'Closed' : 'Active'}</Pill>
                </div>
                {p.opts.map(o => {
                  const pct = total ? Math.round((o.v / total) * 100) : 0;
                  return (
                    <div key={o.t} className="pollrow">
                      <span className="o">{o.t}</span>
                      <div className="track"><i style={{ width: pct + '%' }} /></div>
                      <span className="v num">{pct}% · {o.v}</span>
                    </div>
                  );
                })}
                <div className="num" style={{ fontSize: 11, color: 'var(--ink3)' }}>{total} votes · {p.elig}</div>
              </div>
            );
          })}
          <button className="a-btn ghost" style={{ marginTop: 6 }} onClick={() => toast('Coming in the real build', 'Create poll, set eligibility, result visibility and closing date.')}>
            <Plus size={14} />Create poll
          </button>
        </div>
      </div>
    </>
  );
}
