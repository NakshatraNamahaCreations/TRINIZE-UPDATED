import { AnnouncementCard } from '@/components/AnnouncementCard';
import { EmptyState, Header, Screen, stagger } from '@/components/ui';
import { useT } from '@/i18n';
import { useStore } from '@/store/store';

export default function Announcements() {
  const { state } = useStore();
  const { t } = useT();
  const list = state.announcements.filter(a => a.aud !== 'Committee only');
  return (
    <Screen header={<Header title={t('home.announcements')} back="/" bell />}>
      {list.length
        ? list.map((a, i) => <AnnouncementCard key={a.id} a={a} delay={stagger(i)} />)
        : <EmptyState icon="megaphone-outline" title={t('ann.empty.t')} body={t('ann.empty.b')} />}
    </Screen>
  );
}
