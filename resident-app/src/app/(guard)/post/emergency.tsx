import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sos } from '@/components/Sos';
import { Icon, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { C } from '@/theme';

/** The guard's emergency screen: alerts from residents to respond to, and raising one from the gate. */
export default function GuardEmergency() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useT();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 12, paddingTop: insets.top + 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line }}>
        <Pressable hitSlop={12} accessibilityLabel={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/post'))}><Icon name="chevron-back" size={24} color={C.ink2} /></Pressable>
        <Txt w={800} style={{ fontSize: 16, flex: 1 }}>{t('sos.title')}</Txt>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingVertical: 10, paddingBottom: 40 }}>
        <Sos guard />
      </ScrollView>
    </View>
  );
}
