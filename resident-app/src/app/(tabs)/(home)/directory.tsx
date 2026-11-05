import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useUI } from '@/components/Overlay';
import { Card, EmptyState, Header, Icon, initials, Input, Meta, Screen, Sect, stagger, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import type { Contact } from '@/store/data';
import { useStore } from '@/store/store';
import { C } from '@/theme';

export default function Directory() {
  const { state } = useStore();
  const { toast } = useUI();
  const { t } = useT();
  const [q, setQ] = useState('');

  const call = (d: Contact) => {
    Linking.openURL('tel:' + d.ph.replace(/\s/g, '')).catch(() => toast(t('dir.cantCall', { name: d.n }), 'call'));
  };

  const match = (d: Contact) => !q.trim() || (d.n + ' ' + d.r).toLowerCase().includes(q.trim().toLowerCase());
  const groups: [string, Contact[]][] = [
    [t('dir.committee'), state.directory.committee.filter(match)],
    [t('dir.emergency'), state.directory.emergency.filter(match)],
    [t('dir.vendors'), state.directory.vendors.filter(match)],
  ];
  const any = groups.some(([, list]) => list.length);

  return (
    <Screen header={<Header title={t('dir.title')} back="/" bell />}>
      <View style={{ paddingTop: 10, paddingHorizontal: 14, justifyContent: 'center' }}>
        <Input placeholder={t('dir.search')} value={q} onChangeText={setQ} autoCorrect={false} style={{ paddingLeft: 36 }} />
        <Icon name="search" size={17} color={C.ink3} style={s.searchIc} />
      </View>
      {!any && <EmptyState icon="search-outline" title={t('dir.none.t')} body={t('dir.none.b', { q })} />}
      {groups.filter(([, list]) => list.length).map(([title, list], gi) => (
        <View key={title}>
          <Sect title={title} />
          <Card delay={stagger(gi, 80)} style={{ paddingVertical: 4 }}>
            {list.map((d, i) => (
              <View key={d.n} style={[s.row, i === list.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={[s.av, { backgroundColor: d.c }]}><Txt w={800} style={{ color: d.tc, fontSize: 13 }}>{initials(d.n)}</Txt></View>
                <View style={{ flex: 1 }}>
                  <Txt w={700} style={{ fontSize: 12.5 }}>{d.n}</Txt>
                  <Meta>{d.r} · {d.ph}</Meta>
                </View>
                <Pressable onPress={() => call(d)} accessibilityLabel={t('dir.call', { name: d.n })} style={s.call}><Icon name="call" size={17} color={C.good} /></Pressable>
              </View>
            ))}
          </Card>
        </View>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  av: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  searchIc: { position: 'absolute', left: 26, bottom: 11 },
  call: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.goodBg, alignItems: 'center', justifyContent: 'center' },
});
