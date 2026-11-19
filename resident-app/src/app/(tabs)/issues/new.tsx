import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useUI } from '@/components/Overlay';
import { Chip } from '@/components/Sheets';
import { Btn, Card, Header, Icon, Input, Meta, Segmented, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ImagePicker } from '@/lib/native';
import { places, type Priority } from '@/store/data';
import { CATEGORIES, checkSafety, guessCategory } from '@/store/logic';
import { useStore } from '@/store/store';
import { C } from '@/theme';

const ASSETS = ['Lift', 'STP', 'Water motor', 'Generator', 'CCTV', 'Gate / security cabin', 'Parking area', 'Clubhouse', 'Garden', 'Corridor lights', 'Sump / tank', 'Drainage'];

/** "Use a form instead": the same ticket the assistant creates, as plain fields — no chat, no typing beyond the problem. */
export default function NewIssue() {
  const router = useRouter();
  const { state, actions } = useStore();
  const { toast } = useUI();
  const { t, tx } = useT();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState<string | null>(null); // null = follow the suggestion from the title
  // this resident's own flat and tower, read when the form opens
  const [PLACES] = useState(places);
  const [loc, setLoc] = useState(PLACES[0]);
  // my flat, or something everyone shares — a shared one needs no flat and goes to the office as a common-area job
  const [about, setAbout] = useState<'unit' | 'common'>('unit');
  const [asset, setAsset] = useState(ASSETS[0]);
  const [other, setOther] = useState('');
  const [pri, setPri] = useState<Priority>('Medium');
  const [photo, setPhoto] = useState<string | undefined>();
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  const category = cat ?? guessCategory(title);
  const place = about === 'common' ? asset : loc === 'other' ? other.trim() : loc;
  const ok = title.trim().length >= 4 && !!place;

  const pick = async () => {
    if (!ImagePicker) { toast(t('issue.photoUnavailable'), 'image'); return; }
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
      if (!res.canceled) setPhoto(res.assets[0].uri);
    } catch {
      toast(t('issue.photoDenied'), 'image');
    }
  };

  const submit = async () => {
    setTried(true);
    if (!ok || busy) return;
    // the same abuse guard as the chat, so the form isn't a way around it
    const safety = checkSafety(title + ' ' + desc, state.ai.threshold);
    if (safety.level !== 'safe') { toast(t('form.rephrase', { words: safety.words.slice(0, 2).join(', ') }), 'shield-checkmark'); return; }
    setBusy(true);
    const id = await actions.createIssueFromForm({ title: title.trim(), desc: desc.trim(), cat: category, loc: place, pri, photo, asset: about === 'common' ? asset : undefined });
    // null: the server refused or couldn't be reached — the reason is on screen, the form keeps what was typed
    if (!id) { setBusy(false); return; }
    router.replace(`/issues/${id}`);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior="padding">
      <Header title={t('form.title')} back="/issues" />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <Meta style={s.intro}>{t('form.intro')}</Meta>
        <Card>
          <Txt w={700} style={s.label}>{t('form.what')}</Txt>
          <Input value={title} onChangeText={setTitle} placeholder={t('form.whatPh')} maxLength={80}
            style={tried && title.trim().length < 4 ? { borderColor: C.bad } : undefined} />
          {tried && title.trim().length < 4 && <Meta style={{ color: C.bad, marginTop: 4 }}>{t('form.whatReq')}</Meta>}

          <Txt w={700} style={s.label}>{t('form.details')}</Txt>
          <Input value={desc} onChangeText={setDesc} placeholder={t('form.detailsPh')} multiline maxLength={600}
            style={{ minHeight: 76, textAlignVertical: 'top' }} />

          <Txt w={700} style={s.label}>{t('form.cat')}</Txt>
          <View style={s.chips}>
            {CATEGORIES.map(c => <Chip key={c} label={tx('cat', c)} on={category === c} onPress={() => setCat(c)} />)}
          </View>
          {cat === null && !!title.trim() && <Meta>{t('form.catAuto')}</Meta>}

          <Txt w={700} style={s.label}>{t('form.about')}</Txt>
          <Segmented items={[['unit', t('form.aboutUnit')], ['common', t('form.aboutCommon')]]} value={about} onChange={setAbout} />
          {about === 'common' && <View style={[s.chips, { marginTop: 8 }]}>{ASSETS.map(a => <Chip key={a} label={a} on={asset === a} onPress={() => setAsset(a)} />)}</View>}

          {about === 'unit' && <>
          <Txt w={700} style={s.label}>{t('form.where')}</Txt>
          <View style={s.chips}>
            {PLACES.map(p => <Chip key={p} label={p} on={loc === p} onPress={() => setLoc(p)} />)}
            <Chip label={t('form.otherPlace')} on={loc === 'other'} onPress={() => setLoc('other')} />
          </View>
          {loc === 'other' && (
            <Input value={other} onChangeText={setOther} placeholder={t('form.otherPh')} maxLength={60} autoFocus
              style={[{ marginTop: 6 }, tried && !other.trim() ? { borderColor: C.bad } : undefined]} />
          )}

          </>}

          <Txt w={700} style={s.label}>{t('form.urgency')}</Txt>
          <Segmented items={[['Low', tx('pri', 'Low')], ['Medium', tx('pri', 'Medium')], ['High', tx('pri', 'High')], ['Emergency', tx('pri', 'Emergency')]]} value={pri} onChange={setPri} />
          {pri === 'Emergency' && <Meta style={{ color: C.bad, marginTop: 6 }}>{t('form.emergencyNote')}</Meta>}

          <Txt w={700} style={s.label}>{t('form.photo')}</Txt>
          {photo ? (
            <View>
              <Image source={{ uri: photo }} style={s.photo} resizeMode="cover" />
              <Pressable onPress={() => setPhoto(undefined)} hitSlop={8} style={s.remove} accessibilityLabel={t('form.removePhoto')}>
                <Icon name="close" size={16} color="#fff" />
              </Pressable>
            </View>
          ) : (
            <Btn variant="ghost" icon="camera-outline" label={t('form.addPhoto')} onPress={pick} style={{ alignSelf: 'flex-start' }} />
          )}
        </Card>
        <Btn full icon="send" label={t(busy ? 'ai.creating' : 'form.submit')} onPress={submit} disabled={busy} />
        <Meta style={s.intro}>{t('form.note')}</Meta>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  intro: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 2 },
  label: { fontSize: 13, marginTop: 14, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  photo: { width: '100%', height: 170, borderRadius: 12, backgroundColor: C.dimBg },
  remove: { position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,.55)', alignItems: 'center', justifyContent: 'center' },
});
