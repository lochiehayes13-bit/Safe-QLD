import {
  JOB_MATERIAL_KIND, JOB_SIGNOFF_KIND, JOB_STATUS_KIND, OFFICE_JOB_STATUSES,
  describeJobChange, materialContentKey, materialLine, officeStatusFor, signOffNote, signatureFilename,
  statusChoices, statusContentKey, statusNameKey, statusPayload,
} from '@/domain/jobActions';
import { hasMarker } from '@/domain/queueKey';

/**
 * What the job card queues, and how it is named.
 *
 * The office's status ids are pinned from a read of the live build, so
 * the one thing that must hold is that a status a job wears on the phone
 * finds its id by name and never by guess. The rest is the shape of the
 * payloads, since the sender in outboundMore trusts them, and the words
 * a person sees on Waiting to send.
 */

describe('the office statuses', () => {
  const seen = [
    { statusName: 'In Progress', statusColor: '#ffcc00', count: 4 },
    { statusName: 'Completed - Ready to Invoice', statusColor: '#33aa33', count: 12 },
    { statusName: 'Site Visit Booked', statusColor: '#8888ff', count: 1 },
    { statusName: '  in progress ', count: 2 },
    { statusName: '', count: 9 },
  ];

  it('pins ids and names only, once each, and none blank', () => {
    const ids = OFFICE_JOB_STATUSES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of OFFICE_JOB_STATUSES) {
      expect(s.id).toMatch(/^\d+$/);
      expect(s.name.trim()).toBe(s.name);
      expect(s.name.length).toBeGreaterThan(0);
      expect(Object.keys(s).sort()).toEqual(['id', 'name']);
    }
  });

  it('joins what the phone has seen to the pinned ids by name, whatever the spacing or case', () => {
    const choices = statusChoices(seen);
    const progress = choices.find((c) => c.name === 'In Progress');
    expect(progress).toEqual({ id: '113', name: 'In Progress', color: '#ffcc00', seen: 6 });
    const ready = choices.find((c) => c.name === 'Completed - Ready to Invoice');
    expect(ready).toMatchObject({ id: '117', color: '#33aa33', seen: 12 });
  });

  it('keeps the pinned order, then lists a name the office uses that the pin list lacks, with no id', () => {
    const choices = statusChoices(seen);
    expect(choices.slice(0, 3).map((c) => c.name)).toEqual(OFFICE_JOB_STATUSES.slice(0, 3).map((s) => s.name));
    const unknown = choices[choices.length - 1]!;
    expect(unknown).toEqual({ name: 'Site Visit Booked', color: '#8888ff', seen: 1 });
    expect(unknown.id).toBeUndefined();
    // A pinned status no job wears is still offered: it is the one a technician often wants next.
    expect(choices.find((c) => c.name === 'On Hold')).toMatchObject({ id: '115', seen: 0 });
  });

  it('counts a job with no status as nothing', () => {
    expect(statusChoices([{ statusName: undefined }, { statusName: '   ' }]).every((c) => c.seen === 0)).toBe(true);
    expect(statusChoices([], [])).toEqual([]);
  });

  it('finds the likely office status for the phone\'s own words, and never one it cannot send', () => {
    const choices = statusChoices(seen);
    expect(officeStatusFor('in-progress', choices)?.id).toBe('113');
    expect(officeStatusFor('complete', choices)?.id).toBe('117');
    // Not "To Be Completed", which is the opposite, even where it is the only "complete" left.
    const only = statusChoices([], [{ id: '103', name: 'To Be Completed' }, { id: '9', name: 'Finished' }]);
    expect(officeStatusFor('complete', only)).toBeUndefined();
    // A "Completed" with no "invoice" still matches; a reviewed one is the office's step, taken last.
    const plain = statusChoices([], [{ id: '369', name: 'Completed & Reviewed' }, { id: '1', name: 'Completed' }]);
    expect(officeStatusFor('complete', plain)?.id).toBe('1');
    expect(officeStatusFor('complete', statusChoices([], [{ id: '369', name: 'Completed & Reviewed' }]))?.id).toBe('369');
    // A status seen on a job but not pinned has no id and is not offered.
    expect(officeStatusFor('in-progress', statusChoices([{ statusName: 'Work in progress' }], []))).toBeUndefined();
  });

  it('normalises a name the way the join does', () => {
    expect(statusNameKey('  NO RESPONSE  ')).toBe('no response');
    expect(statusNameKey('Completed   -  Ready')).toBe('completed - ready');
    expect(statusNameKey(undefined)).toBe('');
  });

  it('builds the payload and keys it on the job, the status and the moment', () => {
    const p = statusPayload({ jobId: '1001', status: { id: '113', name: 'In Progress', seen: 1 }, at: '2026-09-09T00:30:00.000Z' });
    expect(p).toEqual({ jobId: '1001', statusId: '113', statusName: 'In Progress', at: '2026-09-09T00:30:00.000Z' });
    expect(statusContentKey(p)).toMatch(/^[0-9a-f]{16}$/);
    expect(statusContentKey({ ...p, statusName: 'renamed' })).toBe(statusContentKey(p));
    expect(statusContentKey({ ...p, at: '2026-09-09T02:00:00.000Z' })).not.toBe(statusContentKey(p));
  });
});

describe('a material line', () => {
  const base = { jobId: '1001', sectionId: '5', costCenterId: '9', at: '2026-09-09T00:30:00.000Z' };

  it('accepts a catalogue part with a count and trims what was typed', () => {
    const r = materialLine({ ...base, kind: 'catalog', catalogId: ' 4321 ', description: ' Smoke detector ', qty: '2' });
    expect(r).toEqual({ ok: true, payload: { ...base, kind: 'catalog', catalogId: '4321', description: 'Smoke detector', qty: 2 } });
  });

  it('accepts a one-off with words and a fractional count, and carries no catalogue id', () => {
    const r = materialLine({ ...base, kind: 'oneOff', catalogId: '4321', description: 'Conduit, 20 mm', qty: 1.5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.catalogId).toBeUndefined();
      expect(r.payload.qty).toBe(1.5);
    }
  });

  it('refuses what the office would refuse, in words for the screen', () => {
    const why = (r: ReturnType<typeof materialLine>) => (r.ok ? 'ok' : r.why);
    expect(why(materialLine({ ...base, kind: 'oneOff', description: '  ', qty: 1 }))).toMatch(/say what/i);
    expect(why(materialLine({ ...base, kind: 'catalog', description: 'x', qty: 1 }))).toMatch(/pick a part/i);
    expect(why(materialLine({ ...base, kind: 'oneOff', description: 'x', qty: 0 }))).toMatch(/more than zero/);
    expect(why(materialLine({ ...base, kind: 'oneOff', description: 'x', qty: 'two' }))).toMatch(/more than zero/);
    expect(why(materialLine({ ...base, kind: 'oneOff', description: 'x', qty: -1 }))).toMatch(/more than zero/);
    expect(why(materialLine({ ...base, kind: 'oneOff', description: 'x', qty: 1.0001 }))).toMatch(/three decimal/);
    expect(why(materialLine({ ...base, costCenterId: '', kind: 'oneOff', description: 'x', qty: 1 }))).toMatch(/cost centre/);
    expect(why(materialLine({ ...base, jobId: '', kind: 'oneOff', description: 'x', qty: 1 }))).toMatch(/job number/);
  });

  it('keys the same line at two moments as two lines', () => {
    const a = materialLine({ ...base, kind: 'oneOff', description: 'x', qty: 1 });
    const b = materialLine({ ...base, at: '2026-09-09T03:00:00.000Z', kind: 'oneOff', description: 'x', qty: 1 });
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(materialContentKey(a.payload)).not.toBe(materialContentKey(b.payload));
    expect(materialContentKey(a.payload)).toBe(materialContentKey({ ...a.payload }));
  });
});

describe('the sign-off', () => {
  const job = { externalId: '1001', title: 'Six-monthly routine', siteName: 'Fictional Tower' };
  const at = '2026-09-09T00:30:00.000Z';

  it('names the signer, the site, the day and the signature file, with its marker in the text', () => {
    const n = signOffNote(job, '  A. Customer ', at);
    expect(n.jobId).toBe('1001');
    expect(n.signedBy).toBe('A. Customer');
    expect(n.subject).toBe('Signed off - Fictional Tower - 2026-09-09');
    expect(n.note).toContain('SIGNED OFF - Six-monthly routine');
    expect(n.note).toContain('Signed by: A. Customer');
    // The Queensland day and the Queensland clock: a second sign-off the same
    // day is a second file rather than one written over the other.
    expect(n.note).toContain('Sign-off 1001 2026-09-09 103000.svg');
    // 10:30 Brisbane, not 00:30 UTC.
    expect(n.note).toMatch(/Signed: .*10:30/);
    expect(hasMarker(n.note, n.noteKey)).toBe(true);
  });

  it('is one note per signer per Queensland day, however it is spelled', () => {
    const a = signOffNote(job, 'A. Customer', at);
    const b = signOffNote(job, ' a.  customer', '2026-09-09T05:00:00.000Z');
    expect(b.noteKey).toBe(a.noteKey);
    // Next Queensland day: 2026-09-10 begins at 14:00 UTC on the 9th.
    expect(signOffNote(job, 'A. Customer', '2026-09-09T14:30:00.000Z').noteKey).not.toBe(a.noteKey);
    expect(signOffNote(job, 'B. Customer', at).noteKey).not.toBe(a.noteKey);
  });

  it('names the file by the Queensland day and clock, and counts up where even that collides', () => {
    // 14:30 UTC is 00:30 the next Queensland day.
    expect(signatureFilename('1001', '2026-09-09T14:30:00.000Z')).toBe('Sign-off 1001 2026-09-10 003000.svg');
    expect(signatureFilename('1001', '2026-09-09T14:30:00.000Z', 2)).toBe('Sign-off 1001 2026-09-10 003000 (2).svg');
    expect(signatureFilename('1001', '2026-09-09T14:30:00.000Z', 1)).toBe('Sign-off 1001 2026-09-10 003000.svg');
    expect(signatureFilename('1001', 'not a date')).toBe('Sign-off 1001 undated.svg');
  });
});

describe('the words on Waiting to send', () => {
  it('names each kind by what a person would search Simpro for', () => {
    expect(describeJobChange(JOB_STATUS_KIND, { jobId: '1001', statusId: '113', statusName: 'In Progress' }))
      .toBe('Status of job 1001 to In Progress');
    expect(describeJobChange(JOB_MATERIAL_KIND, { jobId: '1001', kind: 'catalog', description: 'Smoke detector', qty: 2 }))
      .toBe('Material on job 1001: 2 × Smoke detector');
    expect(describeJobChange(JOB_MATERIAL_KIND, { jobId: '1001', kind: 'oneOff', description: 'Conduit', qty: 1.5 }))
      .toBe('One-off on job 1001: 1.5 × Conduit');
    expect(describeJobChange(JOB_SIGNOFF_KIND, { jobId: '1001', signedBy: 'A. Customer' }))
      .toBe('Sign-off on job 1001 by A. Customer');
  });

  it('still says something for a payload with pieces missing, and nothing for a kind it does not own', () => {
    expect(describeJobChange(JOB_STATUS_KIND, { statusId: '113' })).toBe('Status of a job to status 113');
    expect(describeJobChange(JOB_MATERIAL_KIND, null)).toBe('Material on a job: a line');
    expect(describeJobChange(JOB_SIGNOFF_KIND, { jobId: '1001', signedBy: ' ' })).toBe('Sign-off on job 1001 by an unnamed customer');
    expect(describeJobChange('job-note', { jobId: '1001' })).toBeUndefined();
  });
});
