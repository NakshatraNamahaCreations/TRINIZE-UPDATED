import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Icon, Meta, Txt } from './ui';
import { useT, type Key } from '@/i18n';
import { LIVE } from '@/lib/api';
import { refreshEverything } from '@/lib/refresh';
import type { SyncPart } from '@/store/data';
import { useStore } from '@/store/store';
import { C } from '@/theme';

/**
 * Whether a list may say "nothing here yet": only once it has loaded from the server without error.
 * Until then — still loading, or the server's answer failed — an empty list is not the truth, so it isn't shown as one.
 * (The demo build has no server: its lists are always "loaded".)
 */
export function useLoaded(part: SyncPart) {
  const { state } = useStore();
  const s = state.sync[part];
  return !LIVE || (!!s?.at && !s.error);
}

const TIME = (iso: string) => {
  const d = new Date(iso);
  const t = `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  return d.toDateString() === new Date().toDateString() ? t : `${d.getDate()}/${d.getMonth() + 1}, ${t}`;
};

/**
 * The state of one list from the server, shown at the top of its screen:
 * loading the first time; a real error (with the reason and Retry) when it couldn't be loaded; or, when it loaded
 * before but the latest refresh failed, a line saying the list shown is from then.
 */
export function SyncNotice({ part }: { part: SyncPart }) {
  const { state } = useStore();
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  if (!LIVE) return null;
  const s = state.sync[part];
  const what = t(('live.part.' + part) as Key);
  const retry = async () => { setBusy(true); try { await refreshEverything(); } finally { setBusy(false); } };

  if (!s) {
    return (
      <View style={s0.loading} accessibilityLiveRegion="polite">
        <ActivityIndicator size="small" color={C.acc} />
        <Meta>{t('live.loading', { what })}</Meta>
      </View>
    );
  }
  if (!s.error) return null;
  const never = !s.at;
  return (
    <View style={[s0.box, never ? s0.bad : s0.warn]} accessibilityRole="alert">
      <Icon name={never ? 'alert-circle' : 'time-outline'} size={18} color={never ? C.bad : C.warn} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Txt w={700} style={{ fontSize: 13.5, color: never ? C.bad : C.warn }}>
          {never ? t('live.failedList', { what }) : t('live.staleList', { what, when: TIME(s.at!) })}
        </Txt>
        <Meta style={{ marginTop: 2 }}>{s.error}</Meta>
      </View>
      <Pressable onPress={retry} disabled={busy} accessibilityRole="button" accessibilityLabel={t('live.retry')} style={({ pressed }) => [s0.retry, (pressed || busy) && { opacity: 0.6 }]}>
        {busy ? <ActivityIndicator size="small" color={C.acc} /> : <Txt w={700} style={{ fontSize: 12.5, color: C.acc }}>{t('live.retry')}</Txt>}
      </Pressable>
    </View>
  );
}

const s0 = StyleSheet.create({
  loading: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', paddingVertical: 24 },
  box: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginHorizontal: 14, marginTop: 12, borderRadius: 12, borderWidth: 1, padding: 12 },
  bad: { backgroundColor: C.badBg, borderColor: '#F5C2BD' },
  warn: { backgroundColor: C.warnBg, borderColor: '#F2D9AC' },
  retry: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, minHeight: 34, minWidth: 64, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.accBorder },
});
