import { useState } from 'react';
import { View } from 'react-native';
import { useUI } from '@/components/Overlay';
import { Btn, Card, EmptyState, Header, IconTile, Meta, Pill, Row, Screen, Sect, Segmented, stagger, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { CalendarForm } from '@/lib/native';
import { SOCIETY, type CommunityEvent } from '@/store/data';
import { useStore } from '@/store/store';
import { C } from '@/theme';

export default function Events() {
  const { state, actions } = useStore();
  const { toast, openSheet } = useUI();
  const { t, tx } = useT();
  const [tab, setTab] = useState<'up' | 'past'>('up');

  // the system "new event" form — the resident confirms and picks the calendar there
  const addToCalendar = async (e: CommunityEvent) => {
    if (!CalendarForm) { toast(t('events.calUnavailable'), 'calendar'); return; }
    const start = new Date(e.at);
    try {
      const res = await CalendarForm.createEventInCalendarAsync({
        title: e.title,
        startDate: start,
        endDate: new Date(start.getTime() + e.mins * 60_000),
        location: e.where + ', ' + SOCIETY.name,
        notes: e.desc,
      });
      if (res.action !== 'canceled') toast(t('events.calOpened'), 'calendar');
    } catch {
      toast(t('events.calUnavailable'), 'calendar');
    }
  };

  return (
    <Screen header={<Header title={t('events.title')} back="/" bell />}>
      <Segmented items={[['up', t('events.up')], ['past', t('events.past')]]} value={tab} onChange={setTab} />
      {tab === 'past' ? (
        state.pastEvents.length ? state.pastEvents.map((e, i) => (
          <Card key={e.id} delay={stagger(i)}>
            <View style={{ flexDirection: 'row', gap: 11 }}>
              <IconTile name={e.icon} size={42} bg={C.dimBg} fg={C.ink2} />
              <View style={{ flex: 1 }}>
                <Txt w={700} style={{ fontSize: 13.5 }}>{e.title}</Txt>
                <Meta style={{ marginTop: 2 }}>{e.when} · {e.where}</Meta>
                <Row style={{ marginTop: 8 }}><Pill tone="dim">{t('events.past')}</Pill><Meta>{t('events.attended', { n: e.attended })}</Meta></Row>
              </View>
            </View>
          </Card>
        )) : <EmptyState icon="calendar-outline" title={t('events.noPast')} />
      ) : (
        <>
          {state.events.map((e, i) => {
            const left = e.cap - e.going;
            const full = left <= 0;
            return (
              <Card key={e.id} delay={stagger(i)}>
                <View style={{ flexDirection: 'row', gap: 11 }}>
                  <IconTile name={e.icon} size={42} bg={full ? C.badBg : C.accBg} fg={full ? C.bad : C.acc} />
                  <View style={{ flex: 1 }}>
                    <Txt w={700} style={{ fontSize: 13.5 }}>{e.title}</Txt>
                    <Meta style={{ marginTop: 2 }}>{e.when} · {e.where}</Meta>
                    <Txt style={{ fontSize: 12, color: C.ink2, marginTop: 4, lineHeight: 17 }}>{e.desc}</Txt>
                    <Row style={{ marginTop: 8 }}>
                      <Pill tone={full ? 'bad' : left <= 5 ? 'warn' : 'good'}>{full ? t('events.full') : t('events.left', { left, cap: e.cap })}</Pill>
                      <Meta>{t('events.going', { n: e.going })}</Meta>
                      {e.mine && <Pill tone="acc">{t('events.you', { status: tx('rsvp', e.mine) })}</Pill>}
                    </Row>
                    <Row style={{ marginTop: 10, gap: 8 }}>
                      {e.mine
                        ? <Btn variant="ghost" label={t('events.change')} onPress={() => actions.unrsvp(e.id)} />
                        : <Btn icon={full ? 'hourglass-outline' : 'checkmark'} label={full ? t('events.waitlist') : t('events.rsvp')} onPress={() => actions.rsvp(e.id)} />}
                      <Btn variant="ghost" icon="calendar-outline" label={t('events.calendar')} onPress={() => addToCalendar(e)} />
                    </Row>
                  </View>
                </View>
              </Card>
            );
          })}

          {state.suggestions.length > 0 && <Sect title={t('events.yourIdeas')} />}
          {state.suggestions.map(sg => (
            <Card key={sg.id} style={{ borderStyle: 'dashed', borderColor: C.accBorder }}>
              <Row><Pill tone="warn">{t('events.pending')}</Pill></Row>
              <Txt w={700} style={{ fontSize: 13.5, marginTop: 4 }}>{sg.title}</Txt>
              <Meta style={{ marginTop: 2 }}>{sg.when} · {sg.where}</Meta>
              {!!sg.note && <Txt style={{ fontSize: 12, color: C.ink2, marginTop: 4, lineHeight: 17 }}>{sg.note}</Txt>}
            </Card>
          ))}
          <Btn full variant="ghost" icon="bulb-outline" label={t('events.suggest')} onPress={() => openSheet('suggest')} />
        </>
      )}
    </Screen>
  );
}
