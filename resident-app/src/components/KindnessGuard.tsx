import { LinearGradient } from 'expo-linear-gradient';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { useT } from '@/i18n';
import type { Safety } from '@/store/logic';
import { C } from '@/theme';

/**
 * "Hold on! Let's keep it positive" — the Community Bot's bottom sheet, shown when something the resident
 * typed trips the safety check, before it is sent. It only suggests: nothing is sent or changed until they choose.
 */
export function KindnessGuard({ safety, onRewrite, onEdit }: {
  /** the check's verdict; null hides the sheet */
  safety: Safety | null;
  /** omitted when the society has switched tone rewrite off */
  onRewrite?: () => void;
  /** close the sheet and hand the text back to the resident */
  onEdit: () => void;
}) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={safety !== null} transparent animationType="slide" onRequestClose={onEdit} statusBarTranslucent>
      <View style={s.veil}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onEdit} accessibilityLabel={t('common.close')} />
        <View style={[s.sheet, { paddingBottom: 18 + insets.bottom }]}>
          <Pressable onPress={onEdit} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')} style={s.close}>
            <Icon name="close" size={20} color={C.ink2} />
          </Pressable>
          <LinearGradient colors={['#A78BFA', '#7C3AED']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.badge}>
            <Icon name="shield" size={36} color="rgba(255,255,255,.95)" />
            <Icon name="heart" size={15} color="#7C3AED" style={s.badgeHeart} />
          </LinearGradient>
          <Txt w={700} style={s.bot}>{t('kind.bot')}</Txt>
          <Txt w={800} style={s.title}>{t('kind.title')} <Txt style={{ fontSize: 16, color: C.red }}>❤</Txt></Txt>
          <Txt style={s.body}>{t('kind.body')}</Txt>
          <Txt style={[s.body, { marginTop: 12 }]}>{t(safety?.level === 'block' ? 'kind.mustRephrase' : 'kind.ask')}</Txt>
          {onRewrite && (
            <Pressable onPress={onRewrite} accessibilityRole="button" style={({ pressed }) => [s.btn, pressed && { opacity: 0.9 }]}>
              <LinearGradient colors={['#8B5CF6', '#6D28D9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.btnFill}>
                <Icon name="sparkles" size={16} color="#fff" />
                <Txt w={800} style={{ fontSize: 14, color: '#fff' }}>{t('guard.rewrite')}</Txt>
              </LinearGradient>
            </Pressable>
          )}
          <Pressable onPress={onEdit} accessibilityRole="button" style={({ pressed }) => [s.btn, s.ghost, pressed && { opacity: 0.85 }]}>
            <Txt w={800} style={{ fontSize: 14, color: C.ink }}>{t('guard.edit')}</Txt>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  veil: { flex: 1, backgroundColor: 'rgba(6,10,18,.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingTop: 26, paddingHorizontal: 22, alignItems: 'center' },
  close: { position: 'absolute', top: 14, right: 14, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  badge: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  badgeHeart: { position: 'absolute', top: 23 },
  bot: { fontSize: 14, color: C.ink, marginBottom: 6 },
  title: { fontSize: 17, color: C.ink, textAlign: 'center', marginBottom: 12 },
  body: { fontSize: 14, color: C.ink2, textAlign: 'center', lineHeight: 21, maxWidth: 300 },
  btn: { alignSelf: 'stretch', borderRadius: 999, overflow: 'hidden', marginTop: 10 },
  btnFill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 50 },
  ghost: { backgroundColor: '#F1F0F7', minHeight: 50, alignItems: 'center', justifyContent: 'center' },
});
