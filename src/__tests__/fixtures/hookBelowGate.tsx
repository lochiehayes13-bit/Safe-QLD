/**
 * Not a screen: the shape of the timesheet bug, kept so the guard beside it
 * can be shown to fail on the fault it exists for. Nothing imports this.
 */
import React, { useMemo, useState } from 'react';

export function BlankOnLoad({ rows }: { rows: string[] }) {
  const [record, setRecord] = useState<string | null>(null);
  if (!record) return null;
  const labels = useMemo(() => rows.map((r) => r.trim()), [rows]);
  return <>{labels.join(', ') + String(setRecord)}</>;
}
