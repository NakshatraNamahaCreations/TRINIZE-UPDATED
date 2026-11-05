import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@/i18n';
import { useStore } from '@/store/store';
import { C } from '@/theme';
import { useUI } from './Overlay';
import { Btn, IconTile, Input, Meta, Txt, type IconName } from './ui';

/** Fades the veil and slides the panel up — the web simulation's .sheet. */
function BottomSheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { t } = useT();
  const [y] = useState(() => new Animated.Value(400));
  useEffect(() => {
    if (visible) { y.setValue(400); Animated.spring(y, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start(); }
  }, [visible, y]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Pressable style={s.veil} onPress={onClose} accessibilityLabel={t('common.close')} />
        <Animated.View style={[s.sheet, { paddingBottom: 26 + insets.bottom, transform: [{ translateY: y }] }]}>
          <View style={s.grab} />
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CreateOption({ icon, bg, fg, title, sub, onPress }: { icon: IconName; bg: string; fg: string; title: string; sub: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.opt, pressed && { borderColor: C.acc }]}>
      <IconTile name={icon} bg={bg} fg={fg} size={40} />
      <View style={{ flex: 1 }}>
        <Txt w={700} style={{ fontSize: 13.5 }}>{title}</Txt>
        <Txt style={{ fontSize: 11.5, color: C.ink2 }}>{sub}</Txt>
      </View>
    </Pressable>
  );
}

/** Event idea for the committee — lands in Events → Your suggestions as "awaiting committee". */
function SuggestForm() {
  const { actions } = useStore();
  const { closeSheet } = useUI();
  const { t } = useT();
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [where, setWhere] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const ok = title.trim() && when.trim() && where.trim();

  const send = () => {
    setTried(true);
    if (!ok) return;
    actions.suggestEvent({ title: title.trim(), when: when.trim(), where: where.trim(), note: note.trim() });
    closeSheet();
  };
  const miss = (v: string) => tried && !v.trim() && { borderColor: C.bad };

  return (
    <View>
      <IconTile name="bulb-outline" size={54} radius={27} bg={C.goodBg} fg={C.good} style={{ alignSelf: 'center', marginBottom: 8 }} />
      <Txt w={800} style={{ fontSize: 14, textAlign: 'center' }}>{t('sheet.event.t')}</Txt>
      <Meta style={{ textAlign: 'center', marginTop: 2, marginBottom: 10 }}>{t('sug.desc')}</Meta>
      <Meta style={s.label}>{t('sug.name')}</Meta>
      <Input value={title} onChangeText={setTitle} placeholder={t('sug.namePh')} maxLength={80} style={miss(title)} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Meta style={s.label}>{t('sug.when')}</Meta>
          <Input value={when} onChangeText={setWhen} placeholder={t('sug.whenPh')} maxLength={60} style={miss(when)} />
        </View>
        <View style={{ flex: 1 }}>
          <Meta style={s.label}>{t('sug.where')}</Meta>
          <Input value={where} onChangeText={setWhere} placeholder={t('sug.wherePh')} maxLength={60} style={miss(where)} />
        </View>
      </View>
      <Meta style={s.label}>{t('sug.note')}</Meta>
      <Input value={note} onChangeText={setNote} placeholder={t('sug.notePh')} multiline maxLength={300} style={{ minHeight: 64, textAlignVertical: 'top' }} />
      {tried && !ok && <Meta style={{ color: C.bad, marginTop: 6 }}>{t('sug.req')}</Meta>}
      <Btn icon="send" label={t('sug.send')} onPress={send} style={{ marginTop: 12 }} />
    </View>
  );
}

const CATS = ['General', 'Help received', 'Motivation', 'Kindness'];
const RECIPIENTS = ['The whole community', 'Arjun Mehta (T1-1503)', 'Rohit Sharma (T2-0704)', 'Neha Iyer (T5-0110)', 'Security team'];

function GratitudeForm() {
  const { actions } = useStore();
  const { toast, closeSheet } = useUI();
  const { t, tx } = useT();
  const [text, setText] = useState('');
  const [cat, setCat] = useState(CATS[0]);
  const [to, setTo] = useState(RECIPIENTS[0]);
  const [sending, setSending] = useState(false);

  const send = () => {
    const note = text.trim();
    if (!note) { toast(t('grat.writeFirst'), 'create'); return; }
    setSending(true);
    actions.sendGratitude(note, cat, to);
    closeSheet();
  };

  return (
    <View>
      <IconTile name="mail-open-outline" size={54} radius={27} bg={C.aiBg} fg={C.ai} style={{ alignSelf: 'center', marginBottom: 8 }} />
      <Txt w={800} style={{ fontSize: 14, textAlign: 'center' }}>{t('grat.title')}</Txt>
      <Meta style={{ textAlign: 'center', marginTop: 2, marginBottom: 10 }}>
        {t('grat.desc')}
      </Meta>
      <Input
        style={{ minHeight: 80, textAlignVertical: 'top' }}
        multiline maxLength={200} value={text} onChangeText={setText}
        placeholder={t('grat.placeholder')}
      />
      <Meta style={{ textAlign: 'right', marginVertical: 4 }}>{text.length} / 200</Meta>
      <View style={s.chips}>
        {CATS.map(c => <Chip key={c} label={tx('gcat', c)} on={cat === c} onPress={() => setCat(c)} />)}
      </View>
      <Meta style={{ marginTop: 6, marginBottom: 2, color: C.ink2 }}>{t('grat.sendTo')}</Meta>
      <View style={s.chips}>
        {RECIPIENTS.map(r => <Chip key={r} label={tx('to', r)} on={to === r} onPress={() => setTo(r)} />)}
      </View>
      <Btn variant="gradient" icon="heart" label={t('grat.title')} onPress={send} disabled={sending} style={{ marginTop: 10 }} />
    </View>
  );
}

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, on && { backgroundColor: C.ai, borderColor: C.ai }]}>
      <Txt w={700} style={[{ fontSize: 11.5, color: C.ink2 }, on && { color: '#fff' }]}>{label}</Txt>
    </Pressable>
  );
}

/** Root-level sheets, opened from the tab bar "+" and from Home. */
export function Sheets() {
  const router = useRouter();
  const { sheet, closeSheet, openSheet } = useUI();
  const { actions } = useStore();
  const { t } = useT();

  return (
    <BottomSheet visible={sheet !== null} onClose={closeSheet}>
      {sheet === 'create' && (
        <View>
          <Txt w={800} style={{ fontSize: 14, marginBottom: 10 }}>{t('sheet.create')}</Txt>
          <CreateOption icon="chatbubbles-outline" bg={C.accBg} fg={C.acc} title={t('sheet.disc.t')} sub={t('sheet.disc.s')}
            onPress={() => { closeSheet(); router.navigate('/compose'); }} />
          <CreateOption icon="construct-outline" bg="#FEF0DC" fg="#B54708" title={t('sheet.issue.t')} sub={t('sheet.issue.s')}
            onPress={() => { closeSheet(); router.navigate('/assistant'); actions.sendChat('Report an issue'); }} />
          <CreateOption icon="heart-outline" bg="#FCE7F3" fg="#BE185D" title={t('sheet.grat.t')} sub={t('sheet.grat.s')}
            onPress={() => openSheet('gratitude')} />
          <CreateOption icon="calendar-outline" bg={C.goodBg} fg={C.good} title={t('sheet.event.t')} sub={t('sheet.event.s')}
            onPress={() => openSheet('suggest')} />
        </View>
      )}
      {sheet === 'gratitude' && <GratitudeForm />}
      {sheet === 'suggest' && <SuggestForm />}
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  veil: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(6,10,18,.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 16, paddingHorizontal: 16 },
  grab: { width: 40, height: 4, borderRadius: 99, backgroundColor: '#D6DDE8', alignSelf: 'center', marginBottom: 14 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1, borderColor: C.line, borderRadius: 14, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 4 },
  label: { color: C.ink2, marginTop: 8, marginBottom: 4 },
  chip: { borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
});
