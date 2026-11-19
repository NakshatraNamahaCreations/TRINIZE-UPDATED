import { useFocusEffect } from '@/lib/refresh';
import { useCallback, useState } from 'react';
import { Linking, View } from 'react-native';
import { Card, EmptyState, Header, Icon, IconTile, Meta, Screen, stagger, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { documents, nice, opened, type Doc } from '@/lib/owner';
import { C } from '@/theme';

/** Files the society office has shared with me: leases, insurance, statements. */
export default function OwnerDocuments() {
  const { t, tx } = useT();
  const [list, setList] = useState<Doc[] | null>(null);
  useFocusEffect(useCallback(() => { documents().then(setList).catch(() => setList([])); }, []));
  const open = (d: Doc) => { void opened(d.id); void Linking.openURL(d.fileUrl); };
  return (
    <Screen header={<Header back="/owner" title={t('own.documents')} />}>
      {list !== null && !list.length && <EmptyState icon="document-text-outline" title={t('own.noDocs')} body={t('own.noDocsB')} />}
      {(list ?? []).map((d, i) => (
        <Card key={d.id} delay={stagger(i)} onPress={() => open(d)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <IconTile name="document-text-outline" size={38} />
            <View style={{ flex: 1 }}>
              <Txt w={700} style={{ fontSize: 14 }} numberOfLines={2}>{d.title}</Txt>
              <Meta numberOfLines={1}>{tx('doc', d.kind)} · {d.unit ?? d.society} · {nice(d.createdAt.slice(0, 10))}</Meta>
            </View>
            <Icon name="open-outline" size={18} color={C.ink3} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
