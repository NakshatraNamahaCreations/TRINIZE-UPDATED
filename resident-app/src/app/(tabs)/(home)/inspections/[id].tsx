import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { InspectionReport } from '@/components/InspectionReport';
import { useUI } from '@/components/Overlay';
import { Btn, Card, EmptyState, Header, Input, Meta, Screen, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { acknowledge, myReport, type Full } from '@/lib/inspections';

/** One shared inspection report, and "I have read this" — recorded with my name and the time. */
export default function InspectionReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const { toast } = useUI();
  const [r, setR] = useState<Full | null>(null);
  const [gone, setGone] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { myReport(id).then(setR).catch(() => setGone(true)); }, [id]);

  const ack = async () => {
    setBusy(true);
    try { setR(await acknowledge(id, note.trim())); toast(t('ins.ackDone'), 'checkmark-circle'); }
    catch (e) { toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle'); }
    setBusy(false);
  };

  return (
    <Screen header={<Header back="/inspections" title={r?.ref ?? t('ins.mine')} />}>
      {gone && <EmptyState icon="clipboard-outline" title={t('ins.gone')} body={t('ins.goneS')} />}
      {r && <InspectionReport r={r} />}
      {r && !r.ack && (
        <Card>
          <Txt w={700} style={{ fontSize: 14 }}>{t('ins.ackT')}</Txt>
          <Meta style={{ marginTop: 3 }}>{t('ins.ackS')}</Meta>
          <Input value={note} onChangeText={setNote} placeholder={t('ins.ackPh')} maxLength={500} multiline style={{ marginTop: 10, minHeight: 60, textAlignVertical: 'top' }} />
          <Btn full icon="checkmark-done" label={t('ins.ack')} disabled={busy} onPress={ack} style={{ marginTop: 10 }} />
        </Card>
      )}
    </Screen>
  );
}
