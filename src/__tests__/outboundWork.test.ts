import {
  ATTACHMENT_NAME_MAX, NOTE_LIMITS, PUSHED_TO_SIMPRO, SOURCES, WITHHELD_FROM_SIMPRO,
  attachmentContentKey, attachmentFilename, attachmentsForDefect, isAttachmentItem, isCriticalDefect, isNoteItem,
  keyIdentity, keysInNoteText, mimeTypeForPhoto, outboundKey, planOutboundWork, qldDay, qldIsoDay,
  qldMoment, summariseRun, truncateOnSentence, workCompletedNote,
  type CompletedRoutineRun, type OutboundAttachment, type OutboundDefect, type OutboundNoteItem, type OutboundPlan,
  type OutboundResult,
} from '@/domain/outboundWork';
import {
  acceptedKeys, keysAlreadyOnJob, sendOutboundPlan, type SimproPoster,
} from '@/simpro/testResults';

/**
 * Pushing a completed service back to the office.
 *
 * Everything here guards one class of failure: the office acting on a number
 * this app sent that nothing on the phone supports. A service note reading
 * "complete" when nine assets were never reached gets an invoice raised for
 * work that was not done, and unlike a crash nobody ever finds out.
 *
 * So the tests are mostly about what the module refuses to send, and about the
 * two things that must never happen twice — a retry posting a second copy of a
 * service, and a critical defect getting raised as two defects and two jobs.
 */

const run = (over: Partial<CompletedRoutineRun> = {}): CompletedRoutineRun => ({
  runId: 'local-row-1',
  siteId: 'site-1',
  siteName: 'An Example Building',
  jobId: 'JOB-1',
  routineId: 'routine-annual-detection',
  routineLabel: 'Annual detection service',
  frequency: 'yearly',
  system: 'Detection',
  completedAt: '2026-07-03T04:30:00.000Z',
  technician: 'A Technician',
  ...over,
});

const pass = (n: string, over: Partial<OutboundResult> = {}): OutboundResult => ({
  assetId: `a-${n}`, assetNumber: n, name: 'Smoke detector', location: 'Level 1', outcome: 'pass', ...over,
});

const defect = (over: Partial<OutboundDefect> = {}): OutboundDefect => ({
  id: 'd-1',
  location: 'Level 3 east',
  description: 'Sprinkler control valve found closed.',
  severity: 'non-critical',
  status: 'open',
  raisedAt: '2026-07-03T04:30:00.000Z',
  ...over,
});

/**
 * The i-th note in a plan. Every test below that reads a note body reads it
 * through this, because a plan's items are notes and attachments together
 * and only a note has a body; the photographs come after the notes, so the
 * numbering the tests were written with still holds.
 */
const noteAt = (plan: OutboundPlan, i = 0): OutboundNoteItem => {
  const item = plan.items.filter(isNoteItem)[i];
  if (!item) throw new Error(`no note item at ${i} (plan has ${plan.items.length} items)`);
  return item;
};

describe('Queensland dates', () => {
  it('reads an instant as the Queensland day, not the UTC one', () => {
    /*
     * A service finished at 8:30am in Brisbane is stamped 22:30 the previous
     * day in UTC. A month added to the wrong day gives a rectification deadline
     * a day short of the one the regulation gives.
     */
    expect(qldIsoDay('2026-07-02T22:30:00.000Z')).toBe('2026-07-03');
    expect(qldDay('2026-07-02T22:30:00.000Z')).toBe('03/07/2026');
  });

  it('leaves a date-only string alone rather than shifting it a day', () => {
    expect(qldIsoDay('2026-07-03')).toBe('2026-07-03');
    expect(qldDay('2026-07-03')).toBe('03/07/2026');
  });

  it('does not shift for daylight saving, because Queensland does not have it', () => {
    // January and July both UTC+10. A module that applied DST would move one.
    expect(qldIsoDay('2026-01-15T14:00:00.000Z')).toBe('2026-01-16');
    expect(qldIsoDay('2026-07-15T14:00:00.000Z')).toBe('2026-07-16');
  });

  it('refuses to invent a time for a date that has none', () => {
    // "Notified 03/07/2026 10:00" that nobody recorded a time for would be read
    // as evidence that somebody was told at ten in the morning.
    expect(qldMoment('2026-07-03')).toBeUndefined();
    expect(qldMoment('2026-07-02T22:30:00.000Z')).toBe('03/07/2026 08:30 (Qld)');
  });

  it('comes back undefined rather than guessing at something unreadable', () => {
    expect(qldDay('not a date')).toBeUndefined();
    expect(qldDay(undefined)).toBeUndefined();
  });
});

describe('outboundKey', () => {
  it('gives a retry of the same record the same key, so it cannot post twice', () => {
    const a = outboundKey('SRV', ['site-1', 'routine-1'], ['3 passed', '0 failed']);
    const b = outboundKey('SRV', ['site-1', 'routine-1'], ['3 passed', '0 failed']);
    expect(a).toBe(b);
  });

  it('keeps the identity half when the content changes, so an edit reads as an amendment', () => {
    const before = outboundKey('SRV', ['site-1', 'routine-1'], ['3 passed']);
    const after = outboundKey('SRV', ['site-1', 'routine-1'], ['4 passed']);
    expect(after).not.toBe(before);
    expect(keyIdentity(after)).toBe(keyIdentity(before));
  });

  it('normalises whitespace and case, so a retyped note is not a new service', () => {
    expect(outboundKey('SRV', ['Site  One'], ['Done']))
      .toBe(outboundKey('SRV', ['site one'], ['done']));
  });

  it('cannot be confused by where the field boundaries fall', () => {
    // ["ab","c"] and ["a","bc"] joined naively hash alike, which would make two
    // different services one.
    expect(outboundKey('SRV', ['ab', 'c'], ['x']))
      .not.toBe(outboundKey('SRV', ['a', 'bc'], ['x']));
  });

  it('does not read a key out of something that is not one', () => {
    expect(keyIdentity('SRV-nope')).toBeUndefined();
    expect(keyIdentity('')).toBeUndefined();
  });

  it('spends the whole digest on each half rather than throwing the second pass away', () => {
    /*
     * Eight hex digits a side is a 32-bit hash, which reaches an even chance of
     * collision at around 77,000 records — a book of sites gets there inside a
     * few years of monthly services. A collision on the content half is a
     * service the office never receives and nobody goes looking for.
     */
    expect(outboundKey('SRV', ['site-1'], ['x'])).toMatch(/^SRV-[0-9a-f]{16}-[0-9a-f]{16}$/);
  });

  it('keeps a defect notice and a service record apart even where their identity digests agree', () => {
    // Compared as bare hex, the two would eventually cross and a first service
    // record would go out labelled as an amendment of a defect nobody amended.
    const service = outboundKey('SRV', ['site-1', 'attendance'], ['a']);
    const notice = outboundKey('DEF', ['site-1', 'attendance'], ['a']);
    expect(keyIdentity(notice)).not.toBe(keyIdentity(service));
    expect(keyIdentity(service)).toBe(`SRV-${service.split('-')[1]}`);
  });
});

describe('keysInNoteText', () => {
  it('reads our own markers back out of a job note', () => {
    const key = outboundKey('SRV', ['site-1'], ['x']);
    expect(keysInNoteText(`Some note.\n[SQ-REF:${key}]`)).toEqual([key]);
  });

  it('reports each key once however many times it appears', () => {
    const key = outboundKey('SRV', ['site-1'], ['x']);
    expect(keysInNoteText(`[SQ-REF:${key}] and again [SQ-REF:${key}]`)).toHaveLength(1);
  });

  it('finds nothing in a note somebody in the office typed', () => {
    expect(keysInNoteText('Attended site, all good.')).toEqual([]);
  });
});

describe('truncateOnSentence', () => {
  it('leaves text that fits alone', () => {
    expect(truncateOnSentence('Short.', 100)).toEqual({ text: 'Short.', truncated: false, omittedChars: 0 });
  });

  it('sends a note that exactly fills the limit whole', () => {
    /*
     * A note the length of the limit fits. Cutting it loses the last sentence
     * of what a technician wrote, and on this note the thing most likely to be
     * at the end is the list of assets that could not be tested — the one part
     * of it that must not be lost.
     *
     * The character past it is the first that genuinely does not fit.
     */
    const exact = 'A'.repeat(200);
    expect(truncateOnSentence(exact, 200)).toEqual({ text: exact, truncated: false, omittedChars: 0 });
    expect(truncateOnSentence('A'.repeat(201), 200).truncated).toBe(true);
  });

  it('reports a limit of nothing as everything omitted rather than as a clean send', () => {
    /*
     * Nought is not a quiet no-op. The caller decides between posting a note
     * and telephoning the office on whether anything was truncated, and a
     * silent empty note is the case where a critical defect never reaches
     * anybody.
     */
    expect(truncateOnSentence('Anything at all.', 0))
      .toEqual({ text: '', truncated: true, omittedChars: 16 });
    // Nothing in and nothing out is not a truncation.
    expect(truncateOnSentence('', 0)).toEqual({ text: '', truncated: false, omittedChars: 0 });
  });

  it('cuts at a sentence end rather than mid-thought', () => {
    /*
     * The failure this exists for: "the sprinkler control valve was found
     * closed and was" is a different statement from the one that was written.
     */
    const text = `${'The valve was found closed. '.repeat(20)}It was reopened and proved.`;
    const out = truncateOnSentence(text, 200);
    expect(out.text.endsWith('.')).toBe(true);
    expect(out.truncated).toBe(true);
    expect(out.omittedChars).toBeGreaterThan(0);
  });

  it('reports the cut even where there is no boundary to cut on', () => {
    const out = truncateOnSentence('x'.repeat(500), 100);
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(100);
    expect(out.omittedChars).toBeGreaterThan(0);
  });
});

describe('summariseRun', () => {
  it('counts from the rows rather than believing a stored total', () => {
    const s = summariseRun(
      [pass('1'), pass('2', { outcome: 'fail' }), pass('3', { outcome: 'not-tested', notTestedReason: 'Ceiling locked' })],
      [],
    );
    expect(s).toMatchObject({ total: 3, passed: 1, failed: 1, notTested: 1 });
  });

  it('only calls a visit complete when every asset actually got a result', () => {
    // "Complete" is the word the office invoices against.
    expect(summariseRun([pass('1'), pass('2')], []).allAssetsTested).toBe(true);
    expect(summariseRun([pass('1'), pass('2', { outcome: 'not-tested' })], []).allAssetsTested).toBe(false);
  });

  it('buckets not-tested reasons written the same way despite spacing and case', () => {
    const s = summariseRun([
      pass('1', { outcome: 'not-tested', notTestedReason: 'Ceiling locked' }),
      pass('2', { outcome: 'not-tested', notTestedReason: 'ceiling  locked' }),
    ], []);
    expect(s.notTestedReasons).toHaveLength(1);
    expect(s.notTestedReasons[0]).toMatchObject({ count: 2, unrecorded: false });
  });

  it("keeps the reason in the technician's own words", () => {
    const s = summariseRun([pass('1', { outcome: 'not-tested', notTestedReason: 'Ward in use' })], []);
    expect(s.notTestedReasons[0]!.reason).toBe('Ward in use');
  });

  it('gives an unrecorded reason its own bucket rather than rounding it into a pass', () => {
    const s = summariseRun([
      pass('1', { outcome: 'not-tested' }),
      pass('2', { outcome: 'not-tested', notTestedReason: '   ' }),
    ], []);
    expect(s.notTestedReasons).toHaveLength(1);
    expect(s.notTestedReasons[0]).toMatchObject({ count: 2, unrecorded: true });
    expect(s.notTestedReasons[0]!.reason).toBe('reason not recorded');
  });

  it('sorts the unrecorded bucket last however big it gets', () => {
    // It is not a reason, so it must not head the list as though it were one.
    const s = summariseRun([
      pass('1', { outcome: 'not-tested' }),
      pass('2', { outcome: 'not-tested' }),
      pass('3', { outcome: 'not-tested' }),
      pass('4', { outcome: 'not-tested', notTestedReason: 'Ceiling locked' }),
    ], []);
    expect(s.notTestedReasons.at(-1)!.unrecorded).toBe(true);
  });

  it('counts criticals separately from defects raised', () => {
    const s = summariseRun([pass('1')], [defect(), defect({ id: 'd-2', severity: 'critical' })]);
    expect(s).toMatchObject({ defectsRaised: 2, criticalDefects: 1 });
  });
});

describe('isCriticalDefect', () => {
  it('takes the union of the three tests, because they disagree in practice', () => {
    expect(isCriticalDefect(defect({ severity: 'critical' }))).toBe(true);
    expect(isCriticalDefect(defect({ as1851Class: 'critical' }))).toBe(true);
    expect(isCriticalDefect(defect({ qldLimbInoperable: true, qldLimbAdverseImpact: true }))).toBe(true);
  });

  it('needs both Queensland limbs, not one', () => {
    expect(isCriticalDefect(defect({ qldLimbInoperable: true }))).toBe(false);
    expect(isCriticalDefect(defect({ qldLimbAdverseImpact: true }))).toBe(false);
  });

  it('leaves an ordinary defect alone', () => {
    expect(isCriticalDefect(defect())).toBe(false);
  });
});

describe('planOutboundWork — what it refuses to send', () => {
  it('sends nothing without a job, rather than guessing a job number', () => {
    // A guessed job number posts this service against somebody else's work.
    const plan = planOutboundWork(run({ jobId: undefined }), [pass('1')], []);
    expect(plan.items).toEqual([]);
    expect(plan.warnings[0]).toMatchObject({ code: 'no-job-id', severity: 'declined' });
  });

  it('sends nothing when no asset results were recorded', () => {
    const plan = planOutboundWork(run(), [], []);
    expect(plan.items).toEqual([]);
    expect(plan.warnings.map((w) => w.code)).toContain('nothing-recorded');
  });

  it('sends nothing while the run row and the result rows disagree', () => {
    /*
     * The office acts on whichever number goes out, and this module has no way
     * to know which of the two is right.
     */
    const plan = planOutboundWork(
      run(),
      [pass('1'), pass('2')],
      [],
      { declaredCounts: { passed: 3, failed: 0, notTested: 0 } },
    );
    expect(plan.items).toEqual([]);
    const warn = plan.warnings.find((w) => w.code === 'counts-disagree');
    expect(warn?.severity).toBe('declined');
    expect(warn?.message).toContain('3 passed');
    expect(warn?.message).toContain('2 / 0 / 0');
  });

  it('sends when the declared counts agree', () => {
    const plan = planOutboundWork(
      run(), [pass('1'), pass('2')], [],
      { declaredCounts: { passed: 2, failed: 0, notTested: 0 } },
    );
    expect(plan.items).toHaveLength(1);
  });

  it('does not send a service the office has already accepted', () => {
    const first = planOutboundWork(run(), [pass('1')], []);
    const again = planOutboundWork(run(), [pass('1')], [], {
      alreadySentKeys: [first.items[0]!.key],
    });
    expect(again.items).toEqual([]);
    expect(again.warnings.map((w) => w.code)).toContain('already-sent');
  });

  it('does not send a defect the office already has', () => {
    // A second copy reads as a second defect and gets a second job raised.
    const plan = planOutboundWork(run(), [pass('1')], [
      defect({ severity: 'critical', sentToOfficeAt: '2026-07-04T00:00:00.000Z' }),
    ]);
    const warn = plan.warnings.find((w) => w.code === 'defect-already-with-office');
    expect(warn?.severity).toBe('declined');
    expect(plan.items.filter((i) => i.urgency === 'critical')).toEqual([]);
  });

  it('leaves a defect the office already has out of the counts too', () => {
    const plan = planOutboundWork(run(), [pass('1')], [
      defect({ sentToOfficeAt: '2026-07-04T00:00:00.000Z' }),
    ]);
    expect(plan.summary.defectsRaised).toBe(0);
  });

  it('says so rather than quietly dropping one of two critical defects it cannot tell apart', () => {
    /*
     * Same location, same description, same instant: one key, one identical
     * note. The send layer would post the first, skip the second as a duplicate
     * and record it as accepted — a critical defect lost with a tick beside it.
     */
    const twin = { severity: 'critical' as const, location: 'Plant room', description: 'Pump will not start.' };
    const plan = planOutboundWork(run(), [pass('1')], [
      defect({ id: 'd-1', ...twin }), defect({ id: 'd-2', ...twin }),
    ]);
    expect(plan.items.filter((i) => i.urgency === 'critical')).toHaveLength(1);
    const warn = plan.warnings.find((w) => w.code === 'indistinguishable-defects');
    expect(warn?.severity).toBe('declined');
    expect(warn?.message).toContain('Plant room');
  });

  it('refuses to send a critical defect notice that will not fit, rather than an empty shell', () => {
    const plan = planOutboundWork(
      run(),
      [pass('1')],
      [defect({ severity: 'critical', description: 'x'.repeat(400) })],
      { bodyLimit: 200 },
    );
    const warn = plan.warnings.find((w) => w.code === 'does-not-fit');
    expect(warn?.severity).toBe('declined');
    expect(warn?.message).toContain('Phone the office');
    expect(plan.items.filter((i) => i.urgency === 'critical')).toEqual([]);
  });
});

describe('planOutboundWork — a critical defect', () => {
  const criticalPlan = () => planOutboundWork(
    run(),
    [pass('1')],
    [defect({ severity: 'critical', location: 'Level 3 east' })],
  );

  it('goes out on its own, ahead of the service record', () => {
    // One failing to send must not take the others with it.
    const plan = criticalPlan();
    expect(plan.items).toHaveLength(2);
    expect(plan.items[0]!.urgency).toBe('critical');
    expect(plan.items[1]!.urgency).toBe('routine');
  });

  it('says so in the subject of both notes, in case only one is ever read', () => {
    const plan = criticalPlan();
    expect(noteAt(plan).payload.subject).toContain('CRITICAL DEFECT');
    expect(noteAt(plan, 1).payload.subject).toContain('CRITICAL DEFECT RAISED');
  });

  it('says plainly when nobody recorded the verbal notification', () => {
    const warn = criticalPlan().warnings.find((w) => w.code === 'critical-not-verbally-notified');
    expect(warn?.severity).toBe('caution');
  });

  it('reports a defect that meets a critical test but was recorded otherwise', () => {
    /*
     * Over-notifying costs a phone call. Under-notifying is a statutory failure
     * in a building full of people, so the union wins and the disagreement is
     * surfaced rather than resolved silently.
     */
    const plan = planOutboundWork(run(), [pass('1')], [
      defect({ severity: 'non-critical', qldLimbInoperable: true, qldLimbAdverseImpact: true }),
    ]);
    const warn = plan.warnings.find((w) => w.code === 'critical-severity-disagrees');
    expect(warn?.message).toContain('Confirm the severity');
    expect(plan.items[0]!.urgency).toBe('critical');
  });

  it('runs the 24-hour clock from the maintenance, not from when the defect was typed up', () => {
    /*
     * The written notice is due within 24 hours after the maintenance is carried
     * out. A defect written up at nine in the morning of a two-day attendance
     * does not get a deadline of its own a day early, and a technician who
     * worked to the earlier one would think they were late when they were not.
     */
    const plan = planOutboundWork(
      run({ completedAt: '2026-07-03T07:00:00.000Z' }),
      [pass('1')],
      [defect({ severity: 'critical', raisedAt: '2026-07-02T23:00:00.000Z' })],
    );
    const note = noteAt(plan).payload.note;
    expect(note).toContain('Raised: 03/07/2026');
    expect(note).toContain('due by 04/07/2026 17:00 (Qld)');
  });

  it('will not put an hour on the notice deadline when nobody recorded one', () => {
    /*
     * "Due by 04/07/2026 10:00" out of a date with no time in it is a deadline
     * invented by a formatter, and it is read as one somebody set. The obligation
     * is stated; the hour is not.
     */
    const plan = planOutboundWork(
      run({ completedAt: '2026-07-03' }), [pass('1')], [defect({ severity: 'critical' })],
    );
    const note = noteAt(plan).payload.note;
    expect(note).toContain('due within 24 hours of the maintenance');
    expect(note).not.toMatch(/due by \d\d\/\d\d\/\d{4} \d\d:\d\d/);
    // The one-month clock survives, because a calendar day is all it needs.
    expect(note).toContain('Rectification due by 03/08/2026');
  });

  it('names the occupier for the written notice and the responsible entity for the verbal one', () => {
    // Two obligations to two audiences. A notice addressed to the wrong one is
    // not the notice the regulation asks for.
    const note = noteAt(criticalPlan()).payload.note;
    expect(note).toContain('Written critical defect notice to the occupier');
    expect(note).toContain('Verbally to the responsible entity');
  });

  it('says the photos stay with the report when only a count was handed over', () => {
    // A caller that counted the photographs and did not supply the files has
    // given the plan nothing to attach, and the note must not read as though
    // something was.
    const plan = planOutboundWork(run(), [pass('1')], [
      defect({ severity: 'critical', photoCount: 3 }),
    ]);
    const warn = plan.warnings.find((w) => w.code === 'photos-not-sent');
    expect(warn?.message).toContain('3 photos');
    expect(warn?.message).toContain('stay with the report');
    expect(plan.items.filter(isAttachmentItem)).toEqual([]);
    expect(noteAt(plan).payload.note).toContain('3 photos held with the report');
  });
});

describe('planOutboundWork — amendments', () => {
  it('marks a changed record as an amendment rather than posting a silent second copy', () => {
    const first = planOutboundWork(run(), [pass('1')], []);
    const changed = planOutboundWork(run(), [pass('1'), pass('2')], [], {
      alreadySentKeys: [first.items[0]!.key],
    });
    expect(changed.items).toHaveLength(1);
    expect(changed.warnings.map((w) => w.code)).toContain('amended-record');
    expect(changed.items[0]!.key).not.toBe(first.items[0]!.key);
  });

  it('does not treat a different attendance at the same site as an amendment', () => {
    const july = planOutboundWork(run(), [pass('1')], []);
    const august = planOutboundWork(run({ completedAt: '2026-08-03T04:30:00.000Z' }), [pass('1')], [], {
      alreadySentKeys: [july.items[0]!.key],
    });
    expect(august.warnings.map((w) => w.code)).not.toContain('amended-record');
  });

  it('does not key on the local row id, which changes when the app is reinstalled', () => {
    const a = planOutboundWork(run({ runId: 'local-row-1' }), [pass('1')], []);
    const b = planOutboundWork(run({ runId: 'reinstalled-row-99' }), [pass('1')], []);
    expect(b.items[0]!.key).toBe(a.items[0]!.key);
  });

  it('gives the same key whichever order the result rows arrived in', () => {
    // Two phones recording the same visit produce the same note.
    const a = planOutboundWork(run(), [pass('1'), pass('2')], []);
    const b = planOutboundWork(run(), [pass('2'), pass('1')], []);
    expect(b.items[0]!.key).toBe(a.items[0]!.key);
  });
});

describe('planOutboundWork — a critical defect the office has already seen', () => {
  const critical = (over: Partial<OutboundDefect> = {}) =>
    defect({ severity: 'critical', location: 'Level 3 east', ...over });

  it('is not raised a second time', () => {
    /*
     * The failure this exists to prevent: the same critical defect raised twice
     * in the office system, which becomes two defects, two jobs and two clocks
     * on one fault. A retry after a dropped connection is the ordinary way it
     * happens.
     */
    const first = planOutboundWork(run(), [pass('1')], [critical()]);
    const again = planOutboundWork(run(), [pass('1')], [critical()], {
      alreadySentKeys: [first.items[0]!.key],
    });

    expect(again.items.map((i) => i.urgency)).toEqual(['routine']);
    const declined = again.warnings.find((w) => w.code === 'already-sent');
    expect(declined?.message).toContain('already been accepted');
    // Naming the key, because that is what somebody searches the job for.
    expect(declined?.message).toContain(first.items[0]!.key);
  });

  it('still sends the service record, which is a different thing', () => {
    // One note being a duplicate must not stop the other. The service record
    // for this attendance has not been sent.
    const first = planOutboundWork(run(), [pass('1')], [critical()]);
    const again = planOutboundWork(run(), [pass('1')], [critical()], {
      alreadySentKeys: [first.items[0]!.key],
    });
    expect(again.items).toHaveLength(1);
    expect(noteAt(again).payload.subject).toContain('CRITICAL DEFECT RAISED');
  });

  it('goes out again marked as an amendment when the record has changed', () => {
    /*
     * The caution says it goes out "marked as an amendment", and this is the
     * half that checks the note is actually marked. A second critical defect
     * notice arriving unmarked reads as a second defect.
     */
    const first = planOutboundWork(run(), [pass('1')], [critical()]);
    const changed = planOutboundWork(run(), [pass('1')], [
      critical({ interimMeasures: 'Extinguisher posted at the door until repaired.' }),
    ], { alreadySentKeys: [first.items[0]!.key] });

    expect(changed.warnings.map((w) => w.code)).toContain('amended-record');
    const note = noteAt(changed).payload.note;
    expect(note).toContain('AMENDED: this replaces the critical defect notice sent earlier');
    // And the first one was not marked, so the word means something.
    expect(noteAt(first).payload.note).not.toContain('AMENDED:');
    // A changed record is a new key, or the office cannot tell the two apart.
    expect(changed.items[0]!.key).not.toBe(first.items[0]!.key);
  });

  it('says so when the notice had to be shortened to fit', () => {
    // The notice still goes — a shortened critical defect notice beats none —
    // but the technician is told, and the note says where the rest is.
    const wordy = 'The sprinkler control valve was found closed and padlocked. '.repeat(90);
    const plan = planOutboundWork(run(), [pass('1')], [critical({ description: wordy })]);
    const item = plan.items.filter(isNoteItem).find((i) => i.urgency === 'critical')!;

    expect(item.payload.truncated).toBe(true);
    expect(plan.warnings.some((w) => w.code === 'truncated' && w.message.includes('Level 3 east'))).toBe(true);
    expect(item.payload.note).toContain('Full record');
  });
});

describe('planOutboundWork — the service note', () => {
  it('states the not-tested count in the subject where there is one', () => {
    const plan = planOutboundWork(run(), [
      pass('1'),
      pass('2', { outcome: 'not-tested', notTestedReason: 'Ward in use' }),
    ], []);
    expect(noteAt(plan).payload.subject).toContain('NOT TESTED');
  });

  it('leaves the not-tested phrase out when nothing was missed', () => {
    const plan = planOutboundWork(run(), [pass('1')], []);
    expect(noteAt(plan).payload.subject).not.toContain('NOT TESTED');
  });

  it('never lets a subject exceed what the client will send', () => {
    // Cut here rather than by the client, so what is lost is visible.
    const plan = planOutboundWork(run({ siteName: 'A'.repeat(400) }), [pass('1')], []);
    expect(noteAt(plan).payload.subject.length).toBeLessThanOrEqual(NOTE_LIMITS.subject.chars);
  });

  it('carries its own key in the note text, so the office can see the service was reported', () => {
    const plan = planOutboundWork(run(), [pass('1')], []);
    const item = noteAt(plan);
    expect(keysInNoteText(item.payload.note)).toContain(item.key);
  });

  it('points at where the full record lives', () => {
    const plan = planOutboundWork(run({ reportRef: 'SR-1042' }), [pass('1')], []);
    expect(noteAt(plan).payload.note).toContain('SR-1042');
    expect(noteAt(plan).payload.fullRecordAt).toContain('SR-1042');
  });

  it('says an asset could not be identified rather than sending an internal id', () => {
    const plan = planOutboundWork(run(), [
      { assetId: 'internal-uuid-99', outcome: 'pass' },
    ], []);
    expect(plan.warnings.map((w) => w.code)).toContain('asset-unidentified');
    expect(noteAt(plan).payload.note).not.toContain('internal-uuid-99');
  });

  it('flags a price typed into a note but still sends the words as written', () => {
    /*
     * The office system is the record for what a job costs. Dropping a
     * technician's words silently is worse than sending them, so it is a
     * caution rather than a refusal.
     */
    const plan = planOutboundWork(run({ notes: 'Quoted $450 for the replacement head.' }), [pass('1')], []);
    const warn = plan.warnings.find((w) => w.code === 'money-in-free-text');
    expect(warn?.severity).toBe('caution');
    expect(plan.items).toHaveLength(1);
    expect(noteAt(plan).payload.note).toContain('$450');
  });

  it('flags a price typed into a not-tested reason, which is where one usually lands', () => {
    /*
     * "No access, quoted $450 to open the ceiling" is how a price gets into a
     * service note. A money warning that only reads the technician's summary and
     * the defect descriptions is a rule the app is not actually keeping.
     */
    const plan = planOutboundWork(run(), [
      pass('1', { outcome: 'not-tested', notTestedReason: 'No access, quoted $450 to open the ceiling' }),
    ], []);
    expect(plan.warnings.map((w) => w.code)).toContain('money-in-free-text');
  });

  it('flags a price typed into the interim measures on a defect', () => {
    const plan = planOutboundWork(run(), [pass('1')], [
      defect({ severity: 'critical', interimMeasures: 'Fire watch engaged at $95 an hour until rectified.' }),
    ]);
    expect(plan.warnings.map((w) => w.code)).toContain('money-in-free-text');
  });

  it('catches a price written in words as well as one with a dollar sign', () => {
    // "450 dollars" is a price. A detector that only knows the "$" is one a
    // technician can walk past without meaning to.
    const plan = planOutboundWork(run({ notes: 'Head replacement is about 450 dollars.' }), [pass('1')], []);
    expect(plan.warnings.map((w) => w.code)).toContain('money-in-free-text');
  });

  it('does not cry money over an ordinary sentence', () => {
    const plan = planOutboundWork(run({ notes: 'Replaced 4 heads on level 2.' }), [pass('1')], []);
    expect(plan.warnings.map((w) => w.code)).not.toContain('money-in-free-text');
  });

  it('says out loud that a not-tested asset has no reason recorded', () => {
    const plan = planOutboundWork(run(), [
      pass('1'),
      pass('2', { outcome: 'not-tested' }),
    ], []);
    const warn = plan.warnings.find((w) => w.code === 'not-tested-reason-missing');
    expect(warn?.message).toContain('reason not recorded');
    expect(noteAt(plan).payload.note).toContain('reason not recorded');
  });

  it('counts a passed asset but never lists it, so the not-tested list survives', () => {
    /*
     * Forty lines of "passed" push the not-tested list past the size limit, and
     * the not-tested list is the one thing on this note that must not be lost.
     */
    const plan = planOutboundWork(run(), Array.from({ length: 40 }, (_, i) => pass(String(i + 1))), []);
    expect(noteAt(plan).payload.note).toContain('40 passed');
    expect(noteAt(plan).payload.note).not.toContain('#37');
    expect(noteAt(plan).payload.truncated).toBe(false);
  });

  it('reports what was cut when the note does not fit, and says so in the note', () => {
    const plan = planOutboundWork(
      run(),
      Array.from({ length: 200 }, (_, i) => pass(String(i + 1), {
        outcome: 'not-tested',
        notTestedReason: `Ward ${i} in use for the whole attendance`,
        location: `Level ${i} north wing corridor`,
      })),
      [],
      { bodyLimit: 1200 },
    );
    const item = noteAt(plan);
    expect(item.payload.truncated).toBe(true);
    expect(item.payload.omittedChars).toBeGreaterThan(0);
    expect(item.payload.note).toContain('TRUNCATED');
    expect(item.payload.note.length).toBeLessThanOrEqual(1200);
    expect(plan.warnings.map((w) => w.code)).toContain('truncated');
  });

  it('keeps its own marker even in a truncated note, so a retry is still recognisable', () => {
    const plan = planOutboundWork(
      run(),
      Array.from({ length: 200 }, (_, i) => pass(String(i + 1), {
        outcome: 'not-tested',
        notTestedReason: `Ward ${i} in use for the whole attendance`,
        location: `Level ${i} north wing corridor`,
      })),
      [],
      { bodyLimit: 1200 },
    );
    const item = noteAt(plan);
    expect(keysInNoteText(item.payload.note)).toContain(item.key);
  });

  it('gives a queue row a line a person can act on without opening it', () => {
    const plan = planOutboundWork(run(), [pass('1'), pass('2', { outcome: 'fail' })], []);
    expect(plan.items[0]!.description).toContain('An Example Building');
    expect(plan.items[0]!.description).toContain('JOB-1');
    expect(plan.items[0]!.description).toContain('1 failed');
  });
});

describe('a note that will not fit', () => {
  it('stops adding detail once a section has had to be cut', () => {
    /*
     * The rule that keeps a shortened note readable. Without it a later short
     * section is squeezed in behind a truncated one, and the office reads a
     * defect list that stops mid-way with a full technician's note after it —
     * which looks like the list ended rather than that it was cut.
     *
     * So once one section has been shortened, every later one is dropped whole
     * and named in the footer, and the note says how many characters are only
     * in the full record.
     */
    const defects = Array.from({ length: 30 }, (_, i) => defect({
      id: `d${i}`,
      location: `Level ${i + 1}`,
      description: 'Detector missing from its base and the base left live. '.repeat(3),
    }));

    // A technician's note short enough to fit in what the cut left behind.
    // That is the case the rule exists for: without it this is squeezed in
    // after a defect list that stops mid-sentence.
    const plan = planOutboundWork(run({ notes: 'Ask reception.' }), [pass('1')], defects);
    const note = noteAt(plan).payload;

    expect(note.omittedSections).toEqual(['other defects shortened', 'technician notes']);
    expect(note.note).not.toContain('TECHNICIAN NOTES');
    // Named in the note itself, not only in a warning the office never sees.
    expect(note.note).toContain('technician notes');
    expect(note.note).toContain('Full record');
    expect(note.omittedChars).toBeGreaterThan(0);
  });

  it('drops a later section whole rather than shortening that as well', () => {
    // Two cuts in one note read as two lists that both ended. One cut, and
    // everything after it named as missing, is the honest shape.
    const results = Array.from({ length: 8 }, (_, i) => pass(String(i + 1), i < 3
      ? { outcome: 'not-tested', notTestedReason: 'Locked, no key held on site' }
      : {}));
    const defects = Array.from({ length: 30 }, (_, i) => defect({
      id: `d${i}`,
      location: `Level ${i + 1} east riser cupboard`,
      description: 'Detector missing from its base and the base left live, cover plate absent. '.repeat(3),
    }));

    const plan = planOutboundWork(
      run({ notes: 'Site contact asked for a copy of the report by email.' }),
      results,
      defects,
    );
    expect(noteAt(plan).payload.omittedSections).toEqual([
      'other defects shortened', 'not tested assets', 'technician notes',
    ]);
  });
});

describe('what is deliberately never pushed', () => {
  it('names money, photographs and the statutory forms, with a reason for each', () => {
    const what = WITHHELD_FROM_SIMPRO.map((w) => w.what.toLowerCase()).join(' | ');
    expect(what).toContain('money');
    expect(what).toContain('photographs');
    expect(what).toContain('form 72');
    expect(WITHHELD_FROM_SIMPRO.every((w) => w.why.trim().length > 40)).toBe(true);
  });

  it('is honest about which note limit is a fact and which is a judgement', () => {
    /*
     * The subject figure is certain — this app's own client cuts there. The
     * body figure is a guess at what a server will accept, and a screen that
     * showed them alike would be overstating one of them.
     */
    expect(NOTE_LIMITS.subject.confidence).toBe('high');
    expect(NOTE_LIMITS.body.confidence).toBe('low');
    expect(NOTE_LIMITS.body.why).toContain('No published maximum');
  });
});

describe('planOutboundWork — what the office actually reads', () => {
  const busy = () => planOutboundWork(
    run(),
    [
      ...Array.from({ length: 30 }, (_, i) => pass(String(i + 1))),
      pass('31', { outcome: 'fail', notes: 'No response on test.' }),
      ...Array.from({ length: 9 }, (_, i) => pass(String(40 + i), {
        outcome: 'not-tested', notTestedReason: 'No access to tenancy',
      })),
    ],
    [defect({ id: 'd-crit', severity: 'critical' }), defect({ id: 'd-2' })],
  );

  it('puts the counts in the note itself, not only in the returned object', () => {
    // Nobody in the office opens a payload. The number that decides whether the
    // job can be invoiced has to be in the words.
    const note = noteAt(busy(), 1).payload.note;
    expect(note).toContain('Tested 31: 30 passed, 1 failed');
    expect(note).toContain('Not tested: 9');
    expect(note).toContain('No access to tenancy (9)');
  });

  it('never lets a visit with untested assets read as complete', () => {
    /*
     * The failure this whole module exists for: "service complete" on a job
     * that was nine assets short, invoiced in full because the note said so.
     */
    const note = noteAt(busy(), 1).payload.note;
    expect(note).not.toMatch(/service complete/i);
    expect(note).toContain('9 of 40 assets were NOT tested');
    expect(note).toContain('The routine is not complete for those assets.');
  });

  it('says every asset was tested only when that is true', () => {
    const clean = planOutboundWork(run(), [pass('1'), pass('2')], []);
    expect(noteAt(clean).payload.note).toContain('Every asset with a result recorded on this visit was tested.');
    expect(noteAt(busy(), 1).payload.note).not.toContain('was tested. An asset nobody reached');
  });

  it("does not claim more than it can see, because it never gets the routine's register", () => {
    /*
     * The module is handed the assets that got a result, not the assets the
     * routine covers. Ten detectors nobody reached produce no rows at all, so an
     * unqualified "every asset was tested" would be the same lie in a quieter
     * voice — read as a complete routine and invoiced as one.
     */
    const note = noteAt(planOutboundWork(run(), [pass('1'), pass('2')], [])).payload.note;
    expect(note).toContain('An asset nobody reached carries no result and is not counted above.');
    expect(note).not.toMatch(/every asset (on this visit )?was tested/i);
  });

  it('puts the critical defect above the other defects and the failures in the note', () => {
    // A critical defect four screens down gets read on Monday, by which time the
    // 24-hour written notice is already late.
    const note = noteAt(busy(), 1).payload.note;
    const critical = note.indexOf('*** CRITICAL DEFECT ***');
    expect(critical).toBeGreaterThan(-1);
    expect(critical).toBeLessThan(note.indexOf('OTHER DEFECTS RAISED'));
    expect(critical).toBeLessThan(note.indexOf('FAILED (1)'));
  });

  it('states the statutory clocks in Australian dates at Queensland time', () => {
    /*
     * Completed 14:30 on 3 July in Brisbane. The written notice runs 24 hours
     * from the defect, and rectification one month from the maintenance — counted
     * from the Queensland day, not the UTC one it was stamped with.
     */
    const note = noteAt(busy()).payload.note;
    expect(note).toContain('Raised: 03/07/2026');
    expect(note).toContain('due by 04/07/2026 14:30 (Qld)');
    expect(note).toContain('Rectification due by 03/08/2026');
    expect(note).not.toContain('2026-07-03');
  });

  /**
   * Twelve assets across six differently worded reasons, each of them a
   * paragraph. The reasons line alone runs past a thousand characters, which is
   * what makes this the case that breaks a note filled top to bottom.
   */
  const wordyReasons = () => planOutboundWork(
    run(),
    Array.from({ length: 12 }, (_, i) => pass(String(i + 1), {
      outcome: 'not-tested',
      notTestedReason: `Tenancy ${i % 6} refused access on the day and the managing agent could not be reached `
        + 'before the attendance finished, so the detectors in that tenancy were left for a return visit',
    })),
    [defect({ severity: 'critical' })],
    { bodyLimit: 1800 },
  );

  it('does not let a long not-tested-reasons line crowd the critical defect out of the note', () => {
    /*
     * Filling the note top to bottom is the obvious way and it loses this case:
     * the reasons run to thousands of characters, the counts sit above the
     * critical defect block, and the block that carries a 24-hour statutory
     * clock falls off the end of the note that was supposed to carry it.
     */
    const note = noteAt(wordyReasons(), 1).payload.note;
    expect(note).toContain('*** CRITICAL DEFECT ***');
    expect(note).toContain('Rectification due by');
    expect(note.length).toBeLessThanOrEqual(1800);
  });

  it('cuts the explanation before it cuts the numbers it explains', () => {
    /*
     * When the counts section itself has to be shortened, what goes is the free
     * text at the bottom of it. The sentence that says the routine is not
     * complete is the one line on this note the office acts on, and it sat below
     * an unbounded list of reasons where a cut reached it first.
     */
    const note = noteAt(wordyReasons(), 1).payload.note;
    expect(note).toContain('12 of 12 assets were NOT tested');
    expect(note).toContain('Defects raised: 1, of which 1 CRITICAL.');
    expect(note).toContain('TRUNCATED');
  });

  it('says a defect the office already holds was still raised on this visit', () => {
    /*
     * It is left out of the count because it is not this note's to report twice.
     * Saying nothing at all would make a three-defect visit read as a one-defect
     * visit, which is the same failure as a short service reading as complete.
     */
    const plan = planOutboundWork(run(), [pass('1')], [
      defect({ id: 'd-1' }),
      defect({ id: 'd-2', sentToOfficeAt: '2026-07-03T05:00:00.000Z' }),
    ]);
    const note = noteAt(plan).payload.note;
    expect(note).toContain('Defects raised: 1');
    expect(note).toContain('A further 1 defect was raised on this visit and already reported to the office');
  });

  it('writes the same note whichever order the result rows arrived in', () => {
    // Two phones on the same visit produce the same words, so a duplicate in the
    // office is recognisable by eye as well as by key.
    const rows = [pass('10'), pass('2'), pass('1', { outcome: 'fail' })];
    const a = noteAt(planOutboundWork(run(), rows, [])).payload.note;
    const b = noteAt(planOutboundWork(run(), [...rows].reverse(), [])).payload.note;
    expect(b).toBe(a);
  });

  it('keeps a critical notice and the service record inside the size limit together', () => {
    const plan = planOutboundWork(
      run(),
      Array.from({ length: 120 }, (_, i) => pass(String(i + 1), {
        outcome: 'not-tested', notTestedReason: `Ward ${i} in use for the whole attendance`,
      })),
      [defect({ severity: 'critical' })],
      { bodyLimit: 1500 },
    );
    for (const item of plan.items.filter(isNoteItem)) {
      expect(item.payload.note.length).toBeLessThanOrEqual(1500);
      expect(keysInNoteText(item.payload.note)).toContain(item.key);
    }
    // The two things that must survive a cut, whatever else goes.
    expect(noteAt(plan, 1).payload.note).toContain('Not tested: 120');
    expect(noteAt(plan, 1).payload.note).toContain('*** CRITICAL DEFECT ***');
  });
});

describe('the facts this module stands on', () => {
  it('carries a source, a URL and a reason for its confidence on each one', () => {
    // The rule is that a value from outside the app\'s own reasoning says where
    // it came from in the data, not in a comment nobody ships.
    for (const source of Object.values(SOURCES)) {
      expect(source.url).toMatch(/^https:\/\//);
      expect(source.basis.trim().length).toBeGreaterThan(40);
      expect(['high', 'medium', 'low']).toContain(source.confidence);
    }
  });

  it("marks the note size low confidence, because Simpro does not publish one", () => {
    // A guessed limit that is too high loses the end of a record on the server,
    // silently, and the end is where the not-tested assets are.
    expect(SOURCES[NOTE_LIMITS.body.sourceId].confidence).toBe('low');
    expect(SOURCES[NOTE_LIMITS.body.sourceId].ref).toMatch(/not published/i);
  });
});


/**
 * The send layer.
 *
 * Testable at all only because it takes the two client calls it makes rather
 * than the client class — importing that would pull the platform keystore into a
 * node test. What is worth proving here is not the HTTP: it is that the order
 * the plan chose survives, that a note already on the job is not posted twice,
 * and that a permission failure stops the run instead of burning the retries of
 * everything behind it.
 */
describe('sendOutboundPlan', () => {
  interface Posted { path: string; body: unknown }

  const poster = (over: Partial<SimproPoster> = {}) => {
    const posted: Posted[] = [];
    const client: SimproPoster = {
      listAll: async <T,>(): Promise<T[]> => [],
      request: async <T,>(_method: string, path: string, options: { body?: unknown } = {}) => {
        posted.push({ path, body: options.body });
        return { data: {} as T, total: null };
      },
      ...over,
    };
    return { client, posted };
  };

  const criticalPlan = () => planOutboundWork(
    run(), [pass('1')], [defect({ severity: 'critical' })],
  );

  const fail = (status: number) => async (): Promise<never> => {
    throw Object.assign(new Error(`HTTP ${status}`), { status });
  };

  it('posts the critical defect notice before the service record', async () => {
    const { client, posted } = poster();
    const plan = criticalPlan();
    const report = await sendOutboundPlan(client, plan);
    expect(report.sent).toBe(2);
    expect(posted).toHaveLength(2);
    expect(posted[0]!.body).toMatchObject({ Subject: expect.stringContaining('CRITICAL DEFECT') });
    expect(report.outcomes.map((o) => o.urgency)).toEqual(['critical', 'routine']);
  });

  it('does not post a note the job already carries', async () => {
    // The queue knows what this handset sent. It does not know what the handset
    // it replaced sent, and the duplicate would land in the office either way.
    const plan = criticalPlan();
    const existing = noteAt(plan);
    const { client, posted } = poster({
      listAll: async <T,>(): Promise<T[]> => ([{ Note: existing.payload.note }] as unknown as T[]),
    });
    const report = await sendOutboundPlan(client, plan);
    expect(report.skipped).toBe(1);
    expect(report.sent).toBe(1);
    expect(posted).toHaveLength(1);
    expect(report.remoteCheck).toBe('checked');
  });

  it("sends anyway when the job's notes cannot be read, and says the check was unavailable", async () => {
    /*
     * "Nothing found" and "could not look" are not the same answer. Refusing to
     * push a service record because a second-line check was unavailable would
     * lose real work, so it goes, and the caller is told what was not verified.
     */
    const { client, posted } = poster({ listAll: fail(403) });
    const report = await sendOutboundPlan(client, criticalPlan());
    expect(report.remoteCheck).toBe('unavailable');
    expect(report.remoteCheckError).toContain('could not be read');
    // And which of the two it was. "The key cannot read notes" is fixed in
    // Simpro in a minute; "the tunnel dropped" fixes itself. A technician told
    // only that something failed cannot tell those apart or act on either.
    expect(report.remoteCheckError).toContain('not permitted to read job notes');
    expect(posted).toHaveLength(2);
  });

  it('stops on a permission failure instead of burning the rest of the run against it', async () => {
    const { client } = poster({ request: fail(403) });
    const report = await sendOutboundPlan(client, criticalPlan(), { checkRemote: false });
    expect(report.failed).toBe(1);
    expect(report.notAttempted).toBe(1);
    expect(report.outcomes[0]!.error).toContain('not permitted to add job notes');
    expect(report.outcomes[1]!.status).toBe('not-attempted');
  });

  it('sends a refused token to the sign-in, not to the client secret', async () => {
    // The client renews the token once before this is seen, so a 401 here
    // is a sign-in that no longer works. Telling the person to check the
    // client ID sends them to the wrong setting when they are signed in.
    const { client } = poster({ request: fail(401) });
    const report = await sendOutboundPlan(client, criticalPlan(), { checkRemote: false });
    expect(report.outcomes[0]!.error).toContain('Sign in again');
    expect(report.outcomes[0]!.error).toContain('if nobody is signed in');
    expect(report.outcomes[1]!.status).toBe('not-attempted');
  });

  it('keeps trying after an ordinary network failure, because the next one may work', async () => {
    let calls = 0;
    const { client } = poster({
      request: async <T,>() => {
        calls++;
        if (calls === 1) throw new Error('Network request failed');
        return { data: {} as T, total: null };
      },
    });
    const report = await sendOutboundPlan(client, criticalPlan(), { checkRemote: false });
    expect(report.failed).toBe(1);
    expect(report.sent).toBe(1);
    expect(report.notAttempted).toBe(0);
  });

  it('only reports as accepted what the office actually holds', async () => {
    // A timed-out post may or may not have landed. Recording it as accepted is
    // how a service record goes missing for good.
    const { client } = poster({ request: fail(500) });
    const report = await sendOutboundPlan(client, criticalPlan(), { checkRemote: false });
    expect(acceptedKeys(report)).toEqual([]);
  });

  it('skips a key the caller already knows was accepted, without asking the server', async () => {
    const plan = criticalPlan();
    const { client, posted } = poster();
    const report = await sendOutboundPlan(client, plan, {
      checkRemote: false,
      alreadySent: [plan.items[0]!.key],
    });
    expect(posted).toHaveLength(1);
    expect(acceptedKeys(report)).toEqual(plan.items.map((i) => i.key));
  });

  it("carries the plan's refusals through, so one screen shows sent and not-sent together", async () => {
    const { client } = poster();
    const plan = planOutboundWork(run({ jobId: undefined }), [pass('1')], []);
    const report = await sendOutboundPlan(client, plan);
    expect(report.outcomes).toEqual([]);
    expect(report.declined.join(' ')).toContain('no Simpro job linked');
  });

  it('tells a marker apart from an office note when reading a job back', async () => {
    const plan = criticalPlan();
    const { client } = poster({
      listAll: async <T,>(): Promise<T[]> => ([
        { Note: 'Attended, all good.' },
        { Subject: 'Service', Note: noteAt(plan, 1).payload.note },
      ] as unknown as T[]),
    });
    const keys = await keysAlreadyOnJob(client, 'JOB-1');
    expect([...(keys ?? [])]).toEqual([plan.items[1]!.key]);
  });
});

/**
 * A truncated read of a job's notes is not an answer.
 *
 * The markers are read to decide whether this app already sent the work. A read
 * cut off at the note limit gives a set that looks complete and is not — the
 * marker sits on note 240 of a busy job's 300, is not in the first 200, and the
 * service goes out a second time. That is the one failure the whole key scheme
 * exists to prevent, defeated by a paging limit nobody was told about.
 */
describe('reading a job that has more notes than the limit', () => {
  const jobNote = (text: string) => ({ Subject: '', Note: text });

  const posterWith = (opts: {
    truncated: boolean;
    notes: { Subject: string; Note: string }[];
  }) => {
    const posted: unknown[] = [];
    const client = {
      request: async (_m: string, _p: string, o?: { body?: unknown }) => {
        posted.push(o?.body);
        return { data: {} as never, total: null };
      },
      listAll: async <T,>(): Promise<T[]> => opts.notes as unknown as T[],
      listAllPaged: async <T,>(): Promise<{ items: T[]; truncated: boolean }> =>
        ({ items: opts.notes as unknown as T[], truncated: opts.truncated }),
    };
    return { client, posted };
  };

  it('reports the check as unavailable rather than as clean', async () => {
    const { client } = posterWith({ truncated: true, notes: [jobNote('nothing here')] });
    const plan = planOutboundWork(run(), [pass('1')], []);
    const report = await sendOutboundPlan(client as never, plan);

    expect(report.remoteCheck).toBe('unavailable');
    expect(report.remoteCheckError).toContain('duplicate could not be ruled out');
  });

  it('says the job has too many notes, so somebody can act on it', async () => {
    const { client } = posterWith({ truncated: true, notes: [] });
    const plan = planOutboundWork(run(), [pass('1')], []);
    const report = await sendOutboundPlan(client as never, plan);
    expect(report.outcomes.length).toBeGreaterThan(0);
    expect(report.remoteCheckError).toBeDefined();
  });

  it('still sends, because the work is not lost over an uncertain check', async () => {
    /*
     * The alternative is refusing to send a real service because a job is
     * chatty, and a service stuck on a phone is a worse outcome than a
     * duplicate note somebody can delete.
     */
    const { client, posted } = posterWith({ truncated: true, notes: [] });
    const plan = planOutboundWork(run(), [pass('1')], []);
    const report = await sendOutboundPlan(client as never, plan);
    expect(report.sent).toBeGreaterThan(0);
    expect(posted.length).toBeGreaterThan(0);
  });

  it('treats a complete read as the answer it is', async () => {
    const { client } = posterWith({ truncated: false, notes: [] });
    const plan = planOutboundWork(run(), [pass('1')], []);
    const report = await sendOutboundPlan(client as never, plan);
    expect(report.remoteCheck).toBe('checked');
    expect(report.remoteCheckError).toBeUndefined();
  });

  it('recognises its own marker in a complete read and skips the duplicate', async () => {
    const plan = planOutboundWork(run(), [pass('1')], []);
    const { client } = posterWith({
      truncated: false,
      notes: [jobNote(noteAt(plan).payload.note)],
    });
    const report = await sendOutboundPlan(client as never, plan);
    expect(report.skipped).toBeGreaterThan(0);
    expect(report.sent).toBe(0);
  });
});

/**
 * Photographs.
 *
 * A photograph is the evidence behind a defect, and the office asked for it
 * beside the note that describes the fault. What is worth proving is not the
 * upload — that is the queue's — but the naming, which is how the office
 * reads a file without opening it; the key, which is what stops a second tap
 * uploading the same photograph twice; and that a file gone from the phone
 * is said out loud rather than queued for an upload that can never run.
 */
describe('attachment names', () => {
  const raised = '2026-07-02T22:30:00.000Z';

  it('reads as site, location and Queensland date, so the office can tell what a file is from the list', () => {
    // 22:30 UTC on the 2nd is 08:30 on the 3rd in Brisbane, and the name says the 3rd.
    expect(attachmentFilename({ siteName: 'An Example Building', location: 'Level 3 east', raisedAt: raised, path: 'photos/x.jpg' }))
      .toBe('An Example Building — Level 3 east — 03-07-2026.jpg');
  });

  it('numbers the second and later photographs of one defect before the extension', () => {
    expect(attachmentFilename({ siteName: 'S', location: 'L', raisedAt: raised, sequence: 1 })).toBe('S — L — 03-07-2026.jpg');
    expect(attachmentFilename({ siteName: 'S', location: 'L', raisedAt: raised, sequence: 2 })).toBe('S — L — 03-07-2026 (2).jpg');
  });

  it('replaces the characters no file system takes rather than dropping them', () => {
    // "Level 34 riser" is a different place from "Level 3/4 riser".
    expect(attachmentFilename({ siteName: 'S', location: 'Level 3/4 riser: north', raisedAt: raised }))
      .toBe('S — Level 3-4 riser- north — 03-07-2026.jpg');
  });

  it('keeps the extension the file has, and falls back to jpg where it has none', () => {
    expect(attachmentFilename({ siteName: 'S', location: 'L', raisedAt: raised, path: 'photos/x.png' })).toMatch(/\.png$/);
    expect(attachmentFilename({ siteName: 'S', location: 'L', raisedAt: raised, path: 'photos/x.HEIC' })).toMatch(/\.heic$/);
    expect(attachmentFilename({ siteName: 'S', location: 'L', raisedAt: raised })).toMatch(/\.jpg$/);
  });

  it('says the date was not recorded rather than inventing one', () => {
    expect(attachmentFilename({ siteName: 'S', location: 'L', raisedAt: undefined })).toBe('S — L — date-not-recorded.jpg');
  });

  it('shortens each part on its own, so a long site name cannot push the date off the end', () => {
    const name = attachmentFilename({ siteName: 'A'.repeat(300), location: 'B'.repeat(300), raisedAt: raised, sequence: 2 });
    expect(name.length).toBeLessThanOrEqual(ATTACHMENT_NAME_MAX);
    expect(name).toMatch(/ — 03-07-2026 \(2\)\.jpg$/);
    expect(name).toContain('A — B');
  });

  it('never leaves a part empty', () => {
    expect(attachmentFilename({ siteName: '', location: '   ', raisedAt: raised }))
      .toBe('Site not recorded — Location not recorded — 03-07-2026.jpg');
  });
});

describe('attachment keys', () => {
  it('is the same on every phone: the job, the name and the size, never the path', () => {
    const a = attachmentContentKey({ jobId: 'JOB-1', filename: 'S — L — 03-07-2026.jpg', sizeBytes: 1200 });
    const b = attachmentContentKey({ jobId: 'JOB-1', filename: 'S — L — 03-07-2026.jpg', sizeBytes: 1200 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('changes with the file, so a retaken photograph goes up as the new file it is', () => {
    const before = attachmentContentKey({ jobId: 'JOB-1', filename: 'x.jpg', sizeBytes: 1200 });
    expect(attachmentContentKey({ jobId: 'JOB-1', filename: 'x.jpg', sizeBytes: 1201 })).not.toBe(before);
    expect(attachmentContentKey({ jobId: 'JOB-2', filename: 'x.jpg', sizeBytes: 1200 })).not.toBe(before);
    expect(attachmentContentKey({ jobId: 'JOB-1', filename: 'y.jpg', sizeBytes: 1200 })).not.toBe(before);
  });

  it('declares the type off the stored extension, and jpeg where it cannot tell', () => {
    expect(mimeTypeForPhoto('photos/a.png')).toBe('image/png');
    expect(mimeTypeForPhoto('photos/a.webp')).toBe('image/webp');
    expect(mimeTypeForPhoto('photos/a.heic')).toBe('image/heic');
    expect(mimeTypeForPhoto('photos/a.jpeg')).toBe('image/jpeg');
    expect(mimeTypeForPhoto('photos/a')).toBe('image/jpeg');
  });
});

describe('attachmentsForDefect', () => {
  const context = { jobId: 'JOB-1', siteName: 'An Example Building' };

  it('makes one item per photograph on disk and counts the ones whose file has gone', () => {
    const plan = attachmentsForDefect(defect({
      photos: [{ path: 'photos/a.jpg', sizeBytes: 1200 }, { path: 'photos/gone.jpg' }, { path: 'photos/c.png', sizeBytes: 900 }],
    }), context);
    expect(plan.missing).toBe(1);
    expect(plan.items.map((i) => i.payload.filename)).toEqual([
      'An Example Building — Level 3 east — 03-07-2026.jpg',
      'An Example Building — Level 3 east — 03-07-2026 (2).png',
    ]);
  });

  it('carries what the queue needs, and a key that matches the payload', () => {
    const [item] = attachmentsForDefect(defect({ photos: [{ path: 'photos/a.jpg', sizeBytes: 1200 }] }), context).items;
    expect(item!.kind).toBe('attachment');
    expect(item!.urgency).toBe('routine');
    expect(item!.payload).toEqual({
      jobId: 'JOB-1',
      localUri: 'photos/a.jpg',
      filename: 'An Example Building — Level 3 east — 03-07-2026.jpg',
      mimeType: 'image/jpeg',
      subject: 'Photo of defect at Level 3 east, An Example Building',
      sizeBytes: 1200,
      key: attachmentContentKey({ jobId: 'JOB-1', filename: 'An Example Building — Level 3 east — 03-07-2026.jpg', sizeBytes: 1200 }),
    });
    expect(item!.key).toBe(item!.payload.key);
    expect(item!.description).toContain('JOB-1');
  });

  it('numbers across defects at the same place on the same day, so two files cannot share a name', () => {
    // Two defects in the plant room raised the same day would otherwise both
    // produce "<site> — Plant room — <date>.jpg" and the second would file
    // over the first, or be refused.
    const used = new Map<string, number>();
    const first = attachmentsForDefect(defect({ id: 'd-1', location: 'Plant room', photos: [{ path: 'photos/a.jpg', sizeBytes: 1 }] }), { ...context, used });
    const second = attachmentsForDefect(defect({ id: 'd-2', location: 'Plant room', photos: [{ path: 'photos/b.jpg', sizeBytes: 1 }] }), { ...context, used });
    expect(first.items[0]!.payload.filename).toBe('An Example Building — Plant room — 03-07-2026.jpg');
    expect(second.items[0]!.payload.filename).toBe('An Example Building — Plant room — 03-07-2026 (2).jpg');
  });

  it('plans nothing for a defect with no photographs', () => {
    expect(attachmentsForDefect(defect(), context)).toEqual({ items: [], missing: 0 });
  });
});

describe('planOutboundWork — photographs', () => {
  const photos = (): OutboundDefect['photos'] => [
    { path: 'photos/a.jpg', sizeBytes: 1200 }, { path: 'photos/b.jpg', sizeBytes: 2400 },
  ];

  it('plans one attachment per photograph, after the notes', () => {
    const plan = planOutboundWork(run(), [pass('1')], [defect({ photos: photos() })]);
    expect(plan.items.map((i) => i.kind)).toEqual(['job-note', 'attachment', 'attachment']);
    const attachments = plan.items.filter(isAttachmentItem);
    expect(attachments.map((a) => a.payload.jobId)).toEqual(['JOB-1', 'JOB-1']);
    expect(attachments.map((a) => a.payload.localUri)).toEqual(['photos/a.jpg', 'photos/b.jpg']);
    expect(attachments.every((a) => a.urgency === 'routine')).toBe(true);
    expect(plan.warnings.map((w) => w.code)).not.toContain('photos-not-sent');
  });

  it('says in the note that the photographs are going to the attachments', () => {
    const plan = planOutboundWork(run(), [pass('1')], [defect({ photos: photos() })]);
    expect(noteAt(plan).payload.note).toContain("2 photos being sent to this job's attachments");
  });

  it('names the file in a critical defect notice, which is the one the office opens first', () => {
    const plan = planOutboundWork(run(), [pass('1')], [defect({ severity: 'critical', photos: photos() })]);
    expect(noteAt(plan).payload.note)
      .toContain('2 photos being sent to this job\'s attachments as "An Example Building — Level 3 east — 03-07-2026.jpg"');
  });

  it('keeps a critical notice ahead of its photographs', () => {
    // The notice is the urgent thing, and it says the photographs are coming.
    const plan = planOutboundWork(run(), [pass('1')], [defect({ severity: 'critical', photos: photos() })]);
    expect(plan.items[0]!.kind).toBe('job-note');
    expect(plan.items[0]!.urgency).toBe('critical');
    expect(plan.items.at(-1)!.kind).toBe('attachment');
  });

  it('declines a photograph whose file is gone, out loud, and still sends the rest', () => {
    const plan = planOutboundWork(run(), [pass('1')], [
      defect({ photos: [{ path: 'photos/a.jpg', sizeBytes: 1200 }, { path: 'photos/gone.jpg' }] }),
    ]);
    const warn = plan.warnings.find((w) => w.code === 'photo-file-missing');
    expect(warn?.severity).toBe('declined');
    expect(warn?.message).toContain('no longer on this device');
    expect(plan.items.filter(isAttachmentItem)).toHaveLength(1);
    expect(noteAt(plan).payload.note).toContain("1 of 2 photos being sent to this job's attachments; the other 1 is held with the report");
  });

  it('keeps them on the phone when the switch is off, and says so in the note', () => {
    const plan = planOutboundWork(run(), [pass('1')], [defect({ photos: photos() })], { sendPhotos: false });
    expect(plan.items.filter(isAttachmentItem)).toEqual([]);
    const warn = plan.warnings.find((w) => w.code === 'photos-not-sent');
    expect(warn?.severity).toBe('caution');
    expect(warn?.message).toContain('switched off in Settings');
    expect(noteAt(plan).payload.note).toContain('2 photos held with the report; photos are not attached to this note');
  });

  it('does not queue a photograph that is already queued or on the job', () => {
    const first = planOutboundWork(run(), [pass('1')], [defect({ photos: photos() })]);
    const [a, b] = first.items.filter(isAttachmentItem);
    const again = planOutboundWork(run(), [pass('1')], [defect({ photos: photos() })], { alreadySentKeys: [a!.key] });
    expect(again.items.filter(isAttachmentItem).map((i) => i.key)).toEqual([b!.key]);
    const declined = again.warnings.find((w) => w.code === 'already-sent');
    expect(declined?.message).toContain(a!.payload.filename);
    expect(declined?.message).toContain('already queued for, or on, job JOB-1');
    // And the note says where the other one is: on the job, or queued for
    // it, and not "held with the report", which sends the office to the
    // wrong place for evidence that is already in the attachment list.
    expect(noteAt(again).payload.note)
      .toContain("1 of 2 photos being sent to this job's attachments; 1 is already queued for, or on, this job's attachments.");
    expect(noteAt(again).payload.note).not.toContain('held with the report');
  });

  it('says the photographs are already on the job when an amended note goes out after they went', () => {
    // Service sent with its photographs queued; a not-tested reason is then
    // edited, so the note is composed again as an amendment. The old
    // wording called the photographs "held with the report" although they
    // were on the job's attachments the whole time.
    const first = planOutboundWork(run(), [pass('1')], [defect({ severity: 'critical', photos: photos() })]);
    const photoKeys = first.items.filter(isAttachmentItem).map((i) => i.key);
    const amended = planOutboundWork(
      run({ notes: 'Retest booked for the riser.' }), [pass('1')], [defect({ severity: 'critical', photos: photos() })],
      { alreadySentKeys: [noteAt(first, 0).key, noteAt(first, 1).key, ...photoKeys] },
    );
    expect(amended.items.filter(isAttachmentItem)).toEqual([]);
    // The critical notice is unchanged and already accepted, so the one note
    // going is the amended service record, which repeats the critical block.
    expect(amended.items.filter(isNoteItem).map((i) => i.urgency)).toEqual(['routine']);
    const note = noteAt(amended).payload.note;
    expect(note).toContain('AMENDED RECORD');
    expect(note).toContain('2 photos already queued for, or on, this job\'s attachments as "An Example Building — Level 3 east — 03-07-2026.jpg"');
    expect(note).not.toContain('not attached to this note');
    expect(note).not.toContain('held with the report');
  });

  it('still names the one already on the job when the switch is off today', () => {
    // Sent yesterday with photos on; the switch is off today and the record
    // was amended. The photograph is on the job regardless of the switch.
    const first = planOutboundWork(run(), [pass('1')], [defect({ photos: photos() })]);
    const [a] = first.items.filter(isAttachmentItem);
    const later = planOutboundWork(run(), [pass('1')], [defect({ photos: photos() })], {
      sendPhotos: false, alreadySentKeys: [a!.key],
    });
    expect(later.items.filter(isAttachmentItem)).toEqual([]);
    const warn = later.warnings.find((w) => w.code === 'photos-not-sent');
    expect(warn?.message).toContain('1 photo of the defect at Level 3 east stay');
    expect(warn?.message).toContain('1 photo already went to the job');
    expect(noteAt(later).payload.note)
      .toContain("1 of 2 photos already queued for, or on, this job's attachments; the other 1 is held with the report.");
  });

  it('still sends the photographs when only the service note is already accepted', () => {
    // Sent once with the switch off, or a photograph added to the defect
    // afterwards, or one the queue abandoned: pressing send again is how a
    // person asks for the photographs to go, and the plan used to stop dead
    // at "already sent" before it reached them.
    const first = planOutboundWork(run(), [pass('1')], [defect({ photos: photos() })], { sendPhotos: false });
    expect(first.items.filter(isAttachmentItem)).toEqual([]);
    const again = planOutboundWork(run(), [pass('1')], [defect({ photos: photos() })], {
      alreadySentKeys: [noteAt(first).key],
    });
    expect(again.items.map((i) => i.kind)).toEqual(['attachment', 'attachment']);
    expect(again.items.filter(isNoteItem)).toEqual([]);
    const declined = again.warnings.filter((w) => w.severity === 'declined');
    expect(declined.map((w) => w.code)).toEqual(['already-sent']);
    expect(declined[0]!.message).toContain('Any photographs not yet on the job still go');
    // And the office is told why evidence is arriving with no note announcing it.
    const after = again.warnings.find((w) => w.code === 'photos-after-note');
    expect(after?.severity).toBe('caution');
    expect(after?.message).toContain('2 photographs will arrive on job JOB-1 on their own');
    // The note-only cautions belong to a note that is not going.
    expect(again.warnings.map((w) => w.code)).not.toContain('amended-record');
  });

  it('plans nothing at all when the note and every photograph are already there', () => {
    const first = planOutboundWork(run(), [pass('1')], [defect({ photos: photos() })]);
    const again = planOutboundWork(run(), [pass('1')], [defect({ photos: photos() })], {
      alreadySentKeys: first.items.map((i) => i.key),
    });
    expect(again.items).toEqual([]);
    expect(again.warnings.map((w) => w.code)).not.toContain('photos-after-note');
    expect(again.warnings.find((w) => w.code === 'already-sent' && w.message.includes('service record'))?.message)
      .not.toContain('still go');
  });

  it('still sends the photographs with the switch on when the note is accepted and the critical notice is not', () => {
    // The critical notice is composed on its own, ahead of everything, and
    // is not caught by the service-note guard.
    const first = planOutboundWork(run(), [pass('1')], [defect({ photos: photos() })]);
    const again = planOutboundWork(run(), [pass('1')], [
      defect({ photos: photos() }),
      defect({ id: 'd-2', location: 'Plant room', description: 'Pump will not start.', severity: 'critical' }),
    ], { alreadySentKeys: [noteAt(first).key] });
    // The service key changed with the second defect, so this is an amendment, not a repeat.
    expect(again.items.filter(isNoteItem).map((i) => i.urgency)).toEqual(['critical', 'routine']);
  });

  it('keeps the numbers already issued when a later defect at the same place is added', () => {
    // Day 1: defect A in the plant room, two photographs, sent. Later that
    // day defect B is raised at the same place. The defect list arrives
    // newest first, and B used to take A's name and renumber A's files —
    // new keys, so both uploaded again beside a second file with A's name.
    const a = defect({
      id: 'd-a', location: 'Plant room', raisedAt: '2026-07-03T01:00:00.000Z',
      photos: [{ path: 'photos/a1.jpg', sizeBytes: 1000 }, { path: 'photos/a2.jpg', sizeBytes: 1001 }],
    });
    const b = defect({
      id: 'd-b', location: 'Plant room', raisedAt: '2026-07-03T03:00:00.000Z', description: 'Second fault.',
      photos: [{ path: 'photos/b1.jpg', sizeBytes: 2000 }],
    });
    const first = planOutboundWork(run(), [pass('1')], [a]);
    const firstKeys = first.items.filter(isAttachmentItem).map((i) => i.key);
    expect(first.items.filter(isAttachmentItem).map((i) => i.payload.filename)).toEqual([
      'An Example Building — Plant room — 03-07-2026.jpg',
      'An Example Building — Plant room — 03-07-2026 (2).jpg',
    ]);

    const second = planOutboundWork(run(), [pass('1')], [b, a], { alreadySentKeys: firstKeys });
    const going = second.items.filter(isAttachmentItem);
    expect(going.map((i) => i.payload.localUri)).toEqual(['photos/b1.jpg']);
    expect(going[0]!.payload.filename).toBe('An Example Building — Plant room — 03-07-2026 (3).jpg');
    // A's photographs are recognised as already there, under the names they went up as.
    const declined = second.warnings.filter((w) => w.code === 'already-sent').map((w) => w.message);
    expect(declined).toHaveLength(2);
    expect(declined[0]).toContain('An Example Building — Plant room — 03-07-2026.jpg is already queued');
    expect(declined[1]).toContain('An Example Building — Plant room — 03-07-2026 (2).jpg is already queued');
  });

  it('numbers by the order raised whichever order the defects arrive in', () => {
    const a = defect({ id: 'd-a', location: 'Plant room', raisedAt: '2026-07-03T01:00:00.000Z', photos: [{ path: 'photos/a.jpg', sizeBytes: 1 }] });
    const b = defect({ id: 'd-b', location: 'Plant room', raisedAt: '2026-07-03T03:00:00.000Z', photos: [{ path: 'photos/b.jpg', sizeBytes: 2 }] });
    const names = (plan: OutboundPlan) => plan.items.filter(isAttachmentItem).map((i) => i.key);
    expect(names(planOutboundWork(run(), [pass('1')], [b, a]))).toEqual(names(planOutboundWork(run(), [pass('1')], [a, b])));
  });

  it('leaves the photographs of a defect the office already holds where they are', () => {
    // They would arrive as evidence of a defect nobody can find on the job.
    const plan = planOutboundWork(run(), [pass('1')], [
      defect({ photos: photos(), sentToOfficeAt: '2026-07-04T00:00:00.000Z' }),
    ]);
    expect(plan.items.filter(isAttachmentItem)).toEqual([]);
  });

  it('gives the same attachment key on every phone, so a reinstall cannot upload twice', () => {
    const a = planOutboundWork(run({ runId: 'row-1' }), [pass('1')], [defect({ photos: photos() })]);
    const b = planOutboundWork(run({ runId: 'row-99' }), [pass('1')], [defect({ photos: photos() })]);
    expect(b.items.filter(isAttachmentItem).map((i) => i.key)).toEqual(a.items.filter(isAttachmentItem).map((i) => i.key));
  });

  it('names photographs in what goes to the job, beside the list of what never does', () => {
    const pushed = PUSHED_TO_SIMPRO.map((p) => p.what.toLowerCase()).join(' | ');
    expect(pushed).toContain('photographs');
    expect(pushed).toContain('work-completed');
    expect(PUSHED_TO_SIMPRO.every((p) => p.how.trim().length > 40)).toBe(true);
  });
});

/**
 * The work-completed note.
 *
 * Short on purpose: the service record carries the counts and the defects
 * and goes through its own review. This says the work is done, when and by
 * whom, the moment the job is marked complete — and says in so many words
 * that the job's stage in Simpro was not touched, because "work completed"
 * beside a job still in progress reads as a fault otherwise.
 */
describe('workCompletedNote', () => {
  const job = {
    externalId: '43747',
    title: 'Six-monthly routine',
    siteName: 'An Example Building',
    completedAt: '2026-07-03T04:30:00.000Z',
    technician: 'A Technician',
  };

  it('says what was done, when in Queensland time, by whom, and that the stage in Simpro is untouched', () => {
    const note = workCompletedNote(job);
    expect(note.jobId).toBe('43747');
    expect(note.subject).toBe('Work completed - An Example Building - 03/07/2026');
    expect(note.note).toContain('WORK COMPLETED - Six-monthly routine');
    expect(note.note).toContain('Site: An Example Building');
    expect(note.note).toContain('Completed: 03/07/2026 14:30 (Qld)');
    expect(note.note).toContain('Technician: A Technician');
    expect(note.note).toContain('stage and status in Simpro are not changed by this note');
    expect(note.note).not.toContain('2026-07-03');
    expect(note.truncated).toBe(false);
  });

  it('carries its key in the text, keyed on the job and the Queensland day', () => {
    const note = workCompletedNote(job);
    expect(keysInNoteText(note.note)).toEqual([note.key]);
    // A re-open and re-close an hour later is the same completion.
    expect(workCompletedNote({ ...job, completedAt: '2026-07-03T06:00:00.000Z' }).key).toBe(note.key);
    // The next day is a different event; so is a different job.
    expect(workCompletedNote({ ...job, completedAt: '2026-07-04T04:30:00.000Z' }).key).not.toBe(note.key);
    expect(workCompletedNote({ ...job, externalId: '43748' }).key).not.toBe(note.key);
  });

  it('names the routine service and its counts where a run was linked', () => {
    const note = workCompletedNote(job, {
      routineLabel: 'Annual detection service', frequency: 'yearly', system: 'Detection',
      completedAt: '2026-07-03T04:30:00.000Z', checksPassed: 10, checksFailed: 1, checksNotTested: 2, defectsRaised: 1,
    });
    expect(note.note).toContain('Routine: Annual detection service (yearly) - Detection, 03/07/2026.');
    expect(note.note).toContain('Results: 10 passed, 1 failed, 2 not tested; 1 defect raised.');
    expect(note.note).toContain('The service record note carries the detail.');
  });

  it("carries the technician's own notes and the order number, and says when there is no technician", () => {
    const note = workCompletedNote({ ...job, technician: undefined, notes: 'Key returned to reception.', orderNo: 'PO-77' });
    expect(note.note).toContain('Technician: not recorded');
    expect(note.note).toContain('Order no: PO-77');
    expect(note.note).toContain('TECHNICIAN NOTES\nKey returned to reception.');
  });

  it('names the person who marked it complete ahead of whoever was booked', () => {
    // The job row lists whoever the office rostered; the phone knows who
    // actually pressed complete. The office reads the roster too, so a
    // swap is said in so many words rather than left to look like an error.
    const note = workCompletedNote({ ...job, technician: 'A Technician', completedBy: 'B Technician' });
    expect(note.note).toContain('Completed by: B Technician (booked technician: A Technician)');
    expect(note.note).not.toContain('Technician: A Technician');
    // The same person under both names is one line, not a swap.
    expect(workCompletedNote({ ...job, technician: 'a technician ', completedBy: 'A Technician' }).note)
      .toContain('Completed by: A Technician\n');
    // Nobody signed in and no name set: the booked technician stands, as before.
    expect(workCompletedNote({ ...job, technician: 'A Technician' }).note).toContain('Technician: A Technician');
    // Who completed it is part of the record, so a different person is a different note.
    expect(workCompletedNote({ ...job, completedBy: 'B Technician' }).key)
      .not.toBe(workCompletedNote({ ...job, completedBy: 'C Technician' }).key);
  });

  it('never states a price, and says so when the mapping is asked', () => {
    // Money is the office's record; a completed note is not the place for a figure.
    const note = workCompletedNote({ ...job, notes: 'All done.' });
    expect(note.note).not.toMatch(/\$\s?\d/);
  });
});

/**
 * The send layer and the photographs.
 *
 * A photograph is queued, not posted: the plan's attachment items are handed
 * to whatever queue the caller supplies and reported as queued, never sent,
 * so a technician leaving site knows the notes have landed and the photos
 * are waiting for signal.
 */
describe('sendOutboundPlan — photographs', () => {
  interface Posted { path: string; body: unknown }

  const poster = () => {
    const posted: Posted[] = [];
    const client: SimproPoster = {
      listAll: async <T,>(): Promise<T[]> => [],
      request: async <T,>(_method: string, path: string, options: { body?: unknown } = {}) => {
        posted.push({ path, body: options.body });
        return { data: {} as T, total: null };
      },
    };
    return { client, posted };
  };

  const photoPlan = () => planOutboundWork(run(), [pass('1')], [
    defect({ photos: [{ path: 'photos/a.jpg', sizeBytes: 1200 }] }),
  ]);

  it('queues a photograph rather than posting it, and says queued rather than sent', async () => {
    const { client, posted } = poster();
    const queued: OutboundAttachment[] = [];
    const report = await sendOutboundPlan(client, photoPlan(), {
      checkRemote: false,
      queueAttachment: async (payload) => { queued.push(payload); return { duplicate: false }; },
    });
    expect({ sent: report.sent, queued: report.queued, failed: report.failed }).toEqual({ sent: 1, queued: 1, failed: 0 });
    // Only the note went over the wire.
    expect(posted.map((p) => p.path)).toEqual(['jobs/JOB-1/notes/']);
    expect(queued.map((q) => q.filename)).toEqual(['An Example Building — Level 3 east — 03-07-2026.jpg']);
    expect(report.outcomes.map((o) => o.status)).toEqual(['sent', 'queued']);
  });

  it('reports a photograph the queue already holds as a duplicate, not as newly queued', async () => {
    const { client } = poster();
    const report = await sendOutboundPlan(client, photoPlan(), {
      checkRemote: false,
      queueAttachment: async () => ({ duplicate: true }),
    });
    expect({ queued: report.queued, skipped: report.skipped }).toEqual({ queued: 0, skipped: 1 });
  });

  it('leaves a photograph unattempted, out loud, when no queue was supplied', async () => {
    // Quietly dropping it would leave a report that reads as though everything went.
    const { client } = poster();
    const report = await sendOutboundPlan(client, photoPlan(), { checkRemote: false });
    expect(report.notAttempted).toBe(1);
    const outcome = report.outcomes.find((o) => o.status === 'not-attempted');
    expect(outcome?.error).toContain('No upload queue');
    expect(report.sent).toBe(1);
  });

  it('does not count a queued photograph as accepted: the queue is its record', async () => {
    const { client } = poster();
    const plan = photoPlan();
    const report = await sendOutboundPlan(client, plan, {
      checkRemote: false,
      queueAttachment: async () => ({ duplicate: false }),
    });
    expect(acceptedKeys(report)).toEqual([noteAt(plan).key]);
  });

  it('skips a photograph the caller already knows is queued, without asking the queue', async () => {
    const { client } = poster();
    const plan = photoPlan();
    const attachment = plan.items.find(isAttachmentItem)!;
    let asked = 0;
    const report = await sendOutboundPlan(client, plan, {
      checkRemote: false,
      alreadySent: [attachment.key],
      queueAttachment: async () => { asked++; return { duplicate: false }; },
    });
    expect(asked).toBe(0);
    expect(report.skipped).toBe(1);
  });

  it('reports a queue that failed against that photograph alone', async () => {
    const { client } = poster();
    const report = await sendOutboundPlan(client, photoPlan(), {
      checkRemote: false,
      queueAttachment: async () => { throw new Error('database is locked'); },
    });
    expect({ sent: report.sent, failed: report.failed }).toEqual({ sent: 1, failed: 1 });
    expect(report.outcomes.find((o) => o.status === 'failed')?.error).toBe('database is locked');
  });
});
