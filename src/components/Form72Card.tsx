import React, { useCallback } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { deleteForm72, type StoredForm72 } from '@/db/form72Repo';
import { validateForm72 } from '@/domain/form72';
import { copyState } from '@/domain/formFollowUp';
import { formatAuDate } from '@/export/sheets';
import { showAlert } from '@/components/alert';
import { Button, Card, Chip, Rowed, Txt } from '@/components/ui';

/**
 * One Form 72 in a list: the site's own list, and the list across every site.
 *
 * One card in both places, so the chips cannot say two different things about
 * the same form. `showSite` leads with the building, for the cross-site list.
 */
export function Form72Card({
  form, today, showSite = false, onDeleted,
}: {
  form: StoredForm72;
  /** Queensland calendar day, for whether an owed copy is late. */
  today: string;
  showSite?: boolean;
  /** Called after a draft is deleted, so the list can read itself again. */
  onDeleted: () => void | Promise<void>;
}) {
  const blockers = form.status === 'draft'
    ? validateForm72(form).filter((i) => i.blocking).length
    : 0;
  const copy = copyState(form, today);
  const system = form.systemLabel || 'System not named';
  const date = form.testDate ? formatAuDate(form.testDate) : 'No test date';
  const detail = showSite
    ? [system, date, form.jobExternalId ? `Job ${form.jobExternalId}` : ''].filter(Boolean).join(' · ')
    : [date, form.licenceNumber].filter(Boolean).join(' · ');

  const onDelete = useCallback(() => {
    showAlert('Delete this draft?', 'Nothing on it is kept.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteForm72(form.id);
            await onDeleted();
          } catch (e) {
            showAlert('Not deleted', e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);
  }, [form.id, onDeleted]);

  return (
    <Card onPress={() => router.push({ pathname: '/form72/[id]', params: { id: form.id } })}>
      <Rowed>
        <View style={{ flex: 1 }}>
          <Txt weight="700">{showSite ? (form.siteName || 'Site not named') : system}</Txt>
          <Txt size="sm" tone="muted">{detail}</Txt>
        </View>
        <Chip
          label={form.status === 'issued' ? 'Issued' : 'Draft'}
          tone={form.status === 'issued' ? 'pass' : 'warn'}
        />
      </Rowed>

      <Rowed gap={2} wrap>
        {blockers ? <Chip label={`${blockers} to do before issue`} tone="warn" /> : null}
        {form.status === 'draft' && !blockers ? <Chip label="Ready to issue" tone="pass" /> : null}
        {copy.kind === 'given' ? <Chip label={`Copy given ${formatAuDate(copy.on)}`} tone="pass" /> : null}
        {copy.kind === 'due' ? <Chip label={`Copy due ${formatAuDate(copy.by)}`} tone="warn" /> : null}
        {copy.kind === 'late' ? <Chip label={`Copy was due ${formatAuDate(copy.by)}`} tone="fail" /> : null}
        {/* Never "no deadline": the ten business days still run. */}
        {copy.kind === 'uncounted' ? <Chip label="Copy owed, count by hand" tone="fail" /> : null}
        {form.systemResult !== 'na' ? (
          <Chip
            label={form.systemResult === 'pass' ? 'System passed' : 'System failed'}
            tone={form.systemResult === 'pass' ? 'pass' : 'fail'}
          />
        ) : null}
        {form.criticalDefectsIdentified ? <Chip label="Critical defect" tone="fail" /> : null}
      </Rowed>

      {form.status === 'draft' ? (
        <Rowed>
          <View style={{ flex: 1 }} />
          <Button title="Delete draft" variant="ghost" compact onPress={onDelete} />
        </Rowed>
      ) : null}
    </Card>
  );
}
