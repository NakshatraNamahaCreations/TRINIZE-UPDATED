import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useUI } from '@/components/Overlay';
import { SyncNotice, useLoaded } from '@/components/SyncNotice';
import { Btn, Card, EmptyState, Header, IconTile, Meta, Pill, Row, Screen, Sect, Segmented, stagger, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { CalendarForm } from '@/lib/native';
import { useFocusJump } from '@/lib/useFocusJump';
import { SOCIETY, type CommunityEvent, type PastEvent } from '@/store/data';
import { useStore } from '@/store/store';
import { C } from '@/theme';

export default function Events() {
  const { state, actions } = useStore();
  const loaded = useLoaded('events');
  const { toast, openSheet } = useUI();
  const { t, tx } = useT();
  // an event notification opens this list on its event (?focus=E-52)
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const { scrollRef, place } = useFocusJump(focus);
  const [tab, setTab] = useState<'up' | 'past'>('up');
  // an event moves to Past once it has ended, so nothing stale sits under Upcoming
  const [now] = useState(() => Date.now());
  const ended = (e: CommunityEvent) => new Date(e.at).getTime() + e.mins * 60_000 < now;
  const upcoming = state.events.filter(e => !ended(e)).sort((a, b) => a.at.localeCompare(b.at));
  const past: PastEvent[] = [
    ...state.events.filter(ended).reverse().map(e => ({ id: e.id, title: e.title, when: e.when, where: e.where, attended: e.going, icon: e.icon })),
    ...state.pastEvents,
  ];

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
      // only iOS reports a real save; Android's form returns "done" for saved and discarded alike,
      // so there we only say where the event went
      if (res.action === 'saved') toast(t('events.calOpened'), 'calendar');
      else if (res.action !== 'canceled' && res.action !== 'deleted') toast(t('events.calHanded'), 'calendar');
    } catch {
      toast(t('events.calUnavailable'), 'calendar');
    }
  };

  return (
    <Screen scrollRef={scrollRef} header={<Header title={t('events.title')} back="/" bell />}>
      <SyncNotice part="events" />
      <Segmented items={[['up', t('events.up')], ['past', t('events.past')]]} value={tab} onChange={setTab} />
      {tab === 'past' ? (
        past.length ? past.map((e, i) => (
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
        )) : loaded && <EmptyState icon="calendar-outline" title={t('events.noPast')} />
      ) : (
        <>
          {!upcoming.length && loaded && <EmptyState icon="calendar-outline" title={t('events.noUp')} />}
          {upcoming.map((e, i) => {
            const left = e.cap - e.going;
            const full = left <= 0;
            return (
              <View key={e.id} onLayout={place(e.id)}>
                <Card delay={stagger(i)} style={focus === e.id && s.focused}>
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
              </View>
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

const s = StyleSheet.create({
  focused: { borderColor: C.acc, borderWidth: 1.5 },
});
