import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useUI } from './Overlay';
import { FadeIn, Icon, IconTile, initials, Meta, Pill, Txt } from './ui';
import { useT, type Key } from '@/i18n';
import { clock, dayMonth, hours, managerInfo, todayIst, weekdayOf, type ManagerInfo } from '@/lib/manager';
import { useFocusEffect } from '@/lib/refresh';
import { C, GRAD } from '@/theme';

/** Home: the society's Virtual Property Manager — chat or call them — and their next on-site visit. Hidden when the society has none. */
export function ManagerHome() {
  const router = useRouter();
  const { t } = useT();
  const { toast } = useUI();
  const [info, setInfo] = useState<ManagerInfo | null>(null);
  useFocusEffect(useCallback(() => { managerInfo().then(setInfo).catch(() => {}); }, []));

  const m = info?.manager;
  if (!m) return null;
  const next = info.next;
  const isToday = next?.date === todayIst();
  const chat = () => router.push({ pathname: '/messages', params: { compose: '1', subject: t('vpm.chatSubject', { name: m.name }) } });
  const call = () => m.phone && Linking.openURL('tel:' + m.phone).catch(() => toast(t('dir.cantCall', { name: m.name }), 'call'));

  return (
    <FadeIn>
      <View style={s.wrap}>
        <LinearGradient colors={GRAD.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.card}>
          <Txt w={700} style={{ color: '#E4DAFF', fontSize: 12.5 }}>{t('vpm.yours')}</Txt>
          <View style={s.who}>
            <View style={s.avatar}><Txt w={800} style={{ color: C.acc, fontSize: 16 }}>{initials(m.name)}</Txt></View>
            <View style={{ flex: 1 }}>
              <Txt w={800} style={{ color: '#fff', fontSize: 16 }} numberOfLines={1}>{m.name}</Txt>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Txt style={{ color: '#E4DAFF', fontSize: 12.5 }} numberOfLines={1}>{m.title}</Txt>
                {/* only when they were in the app a few minutes ago; nothing is said otherwise */}
                {m.online && <View style={s.online} accessible accessibilityLabel={t('vpm.online')}><View style={s.dot} /><Txt w={700} style={{ color: '#fff', fontSize: 11 }}>{t('vpm.online')}</Txt></View>}
              </View>
            </View>
          </View>
          <View style={s.acts}>
            <Pressable onPress={chat} accessibilityRole="button" accessibilityLabel={t('vpm.chat')} style={({ pressed }) => [s.act, pressed && { opacity: 0.85 }]}>
              <Icon name="chatbubble-ellipses" size={15} color={C.acc} /><Txt w={700} style={{ color: C.acc, fontSize: 13 }}>{t('vpm.chat')}</Txt>
            </Pressable>
            {!!m.phone && (
              <Pressable onPress={call} accessibilityRole="button" accessibilityLabel={t('vpm.call')} style={({ pressed }) => [s.act, s.actGhost, pressed && { opacity: 0.85 }]}>
                <Icon name="call" size={15} color="#fff" /><Txt w={700} style={{ color: '#fff', fontSize: 13 }}>{t('vpm.call')}</Txt>
              </Pressable>
            )}
          </View>
        </LinearGradient>

        <Pressable onPress={() => router.push('/visits')} accessibilityRole="button" accessibilityLabel={t('vpm.viewSchedule')} style={({ pressed }) => [s.visit, pressed && { opacity: 0.9 }]}>
          <IconTile name="calendar" size={40} radius={12} />
          <View style={{ flex: 1 }}>
            <Txt w={700} style={{ fontSize: 12, color: C.ink3 }}>{t('vpm.next')}</Txt>
            {next ? (
              <>
                <Txt w={800} style={{ fontSize: 14, marginTop: 1 }}>
                  {info.plan && weekdayOf(next.date) === info.plan.weekday ? t('vpm.every', { day: t(('vpm.day.' + info.plan.weekday) as Key) }) : t(('vpm.day.' + weekdayOf(next.date)) as Key)} · {dayMonth(next.date)}
                </Txt>
                <Meta>{hours(next.start, next.end)}</Meta>
              </>
            ) : <Txt w={700} style={{ fontSize: 13.5, marginTop: 1, color: C.ink2 }}>{t('vpm.noVisit')}</Txt>}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            {next && <Pill tone={isToday ? 'good' : 'acc'}>{isToday ? t('vpm.today') + ' · ' + clock(next.start) : t('vpm.upcoming')}</Pill>}
            <Icon name="chevron-forward" size={16} color={C.ink3} />
          </View>
        </Pressable>
      </View>
    </FadeIn>
  );
}

const s = StyleSheet.create({
  wrap: { marginHorizontal: 14, marginTop: 12, borderRadius: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  card: { padding: 16 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  acts: { flexDirection: 'row', gap: 8, marginTop: 14 },
  act: { flex: 1, minHeight: 40, borderRadius: 10, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  actGhost: { backgroundColor: 'rgba(255,255,255,.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,.45)' },
  visit: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  online: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,.16)', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4ADE80' },
});
