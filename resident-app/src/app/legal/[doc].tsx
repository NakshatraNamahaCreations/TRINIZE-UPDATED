import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Card, EmptyState, Header, Meta, Screen, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { SOCIETY } from '@/store/data';
import { C } from '@/theme';

type Doc = 'privacy' | 'terms';
type Section = [heading: string, body: string];

/* Plain-language drafts that describe what this build actually does. They must be reviewed by
   Trinize's legal team (and hosted on the web for the store listings) before a public launch. */
const UPDATED = '16 Nov 2026';

const PRIVACY: Section[] = [
  ['What we collect', 'Your mobile number (to sign you in with a one-time code), your flat and role in the society, and what you add in the app: issues and their photos, posts, replies, reactions, poll votes, event RSVPs, gratitude notes and questions you ask the Community Assistant.'],
  ['Why we use it', `To run ${SOCIETY.name}'s community app: showing notices, routing your issues to the society office and its vendors, counting votes once per flat, and keeping discussions safe. We do not sell your data or show ads.`],
  ['Who can see it', 'Other residents see your posts, replies and your name; your flat number only if you allow it in Privacy settings. The society office sees issues you raise and anything held for review. Gratitude notes are private to the person you thank. Assistant chats are private to you.'],
  ['Where it is kept', 'In this build your data is kept on this phone, separately for each mobile number. When the app is connected to Trinize servers it will be stored there, in India, and the phone copy becomes a cache.'],
  ['Your choices', 'Turn off assistant history, hide your flat number or phone, and control notifications from Profile. You can ask for a copy of your data from Profile → Privacy. To delete your account and its data, contact your society office.'],
  ['Your rights', 'Under India’s Digital Personal Data Protection Act, 2023 you can access, correct and erase your personal data and withdraw consent. Contact your society office and we will respond within 30 days.'],
];

const TERMS: Section[] = [
  ['Who can use the app', `Residents, owners and family members verified by the ${SOCIETY.name} society office. One account per mobile number.`],
  ['Be kind and truthful', 'No abuse, threats, hate, spam or personal attacks. Fair complaints about services are welcome; attacks on people are not. Posts may be held for review by the society’s moderators, and repeated breaches can lead to posting limits.'],
  ['Issues and requests', 'Reporting an issue sends it to the society office. Response times shown in the app are the society’s targets, not guarantees.'],
  ['The Community Assistant', 'Answers come only from approved community documents and live records, and may be incomplete. In an emergency, call security or the numbers in the Directory — do not rely on the assistant.'],
  ['Your content', 'You own what you post. You let the society show it to other residents inside the app.'],
  ['Changes', 'We will tell you in the app before these terms change in a way that affects you.'],
];

export default function Legal() {
  const { doc } = useLocalSearchParams<{ doc: Doc }>();
  const { t, lang } = useT();
  const body = doc === 'privacy' ? PRIVACY : doc === 'terms' ? TERMS : null;
  const title = doc === 'terms' ? t('legal.terms') : t('legal.privacy');

  return (
    <Screen header={<Header title={title} back="/login" />}>
      {!body ? <EmptyState icon="document-text-outline" title={title} /> : (
        <>
          <Meta style={s.meta}>{t('legal.updated', { date: UPDATED })}{lang !== 'en' ? '\n' + t('legal.enOnly') : ''}</Meta>
          <Card>
            {body.map(([h, b], i) => (
              <View key={h} style={[s.sec, i === body.length - 1 && { borderBottomWidth: 0 }]}>
                <Txt w={800} style={{ fontSize: 14 }}>{h}</Txt>
                <Txt style={s.p}>{b}</Txt>
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  meta: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 2 },
  sec: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  p: { fontSize: 13.5, color: C.ink2, lineHeight: 21, marginTop: 4 },
});
