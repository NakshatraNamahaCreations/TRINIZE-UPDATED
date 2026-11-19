import { Sos } from '@/components/Sos';
import { EmptyState, Header, Screen } from '@/components/ui';
import { useT } from '@/i18n';
import { LIVE } from '@/lib/api';

/** Emergency: raise an SOS to security and the office, and the numbers to call. */
export default function Emergency() {
  const { t } = useT();
  return (
    <Screen header={<Header back="/" title={t('sos.title')} />}>
      {LIVE ? <Sos /> : <EmptyState icon="alert-circle-outline" title={t('sos.title')} body={t('sos.demo')} />}
    </Screen>
  );
}
