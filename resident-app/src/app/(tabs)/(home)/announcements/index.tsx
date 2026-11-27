import { AnnouncementCard } from '@/components/AnnouncementCard';
import { SyncNotice, useLoaded } from '@/components/SyncNotice';
import { EmptyState, Header, Screen, stagger } from '@/components/ui';
import { useT } from '@/i18n';
import { useStore } from '@/store/store';

export default function Announcements() {
  const { state } = useStore();
  const { t } = useT();
  const list = state.announcements.filter(a => a.aud !== 'Committee only');
  const loaded = useLoaded('announcements');
  return (
    <Screen header={<Header title={t('home.announcements')} back="/" bell />}>
      <SyncNotice part="announcements" />
      {list.length
        ? list.map((a, i) => <AnnouncementCard key={a.id} a={a} delay={stagger(i)} />)
        : loaded && <EmptyState icon="megaphone-outline" title={t('ann.empty.t')} body={t('ann.empty.b')} />}
    </Screen>
  );
}
