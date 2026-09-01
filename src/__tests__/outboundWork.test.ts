import {
  NOTE_LIMITS, SOURCES, WITHHELD_FROM_SIMPRO,
  isCriticalDefect, keyIdentity, keysInNoteText, outboundKey, planOutboundWork, qldDay, qldIsoDay,
  qldMoment, summariseRun, truncateOnSentence,
  type CompletedRoutineRun, type OutboundDefect, type OutboundResult,
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
    expect(plan.items[0]!.payload.subject).toContain('CRITICAL DEFECT');
    expect(plan.items[1]!.payload.subject).toContain('CRITICAL DEFECT RAISED');
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
    const note = plan.items[0]!.payload.note;
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
    const note = plan.items[0]!.payload.note;
    expect(note).toContain('due within 24 hours of the maintenance');
    expect(note).not.toMatch(/due by \d\d\/\d\d\/\d{4} \d\d:\d\d/);
    // The one-month clock survives, because a calendar day is all it needs.
    expect(note).toContain('Rectification due by 03/08/2026');
  });

  it('names the occupier for the written notice and the responsible entity for the verbal one', () => {
    // Two obligations to two audiences. A notice addressed to the wrong one is
    // not the notice the regulation asks for.
    const note = criticalPlan().items[0]!.payload.note;
    expect(note).toContain('Written critical defect notice to the occupier');
    expect(note).toContain('Verbally to the responsible entity');
  });

  it('says the photos stay with the report rather than implying they were attached', () => {
    const plan = planOutboundWork(run(), [pass('1')], [
      defect({ severity: 'critical', photoCount: 3 }),
    ]);
    const warn = plan.warnings.find((w) => w.code === 'photos-not-sent');
    expect(warn?.message).toContain('3 photos');
    expect(warn?.message).toContain('no attachment endpoint');
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

describe('planOutboundWork — the service note', () => {
  it('states the not-tested count in the subject where there is one', () => {
    const plan = planOutboundWork(run(), [
      pass('1'),
      pass('2', { outcome: 'not-tested', notTestedReason: 'Ward in use' }),
    ], []);
    expect(plan.items[0]!.payload.subject).toContain('NOT TESTED');
  });

  it('leaves the not-tested phrase out when nothing was missed', () => {
    const plan = planOutboundWork(run(), [pass('1')], []);
    expect(plan.items[0]!.payload.subject).not.toContain('NOT TESTED');
  });

  it('never lets a subject exceed what the client will send', () => {
    // Cut here rather than by the client, so what is lost is visible.
    const plan = planOutboundWork(run({ siteName: 'A'.repeat(400) }), [pass('1')], []);
    expect(plan.items[0]!.payload.subject.length).toBeLessThanOrEqual(NOTE_LIMITS.subject.chars);
  });

  it('carries its own key in the note text, so the office can see the service was reported', () => {
    const plan = planOutboundWork(run(), [pass('1')], []);
    const item = plan.items[0]!;
    expect(keysInNoteText(item.payload.note)).toContain(item.key);
  });

  it('points at where the full record lives', () => {
    const plan = planOutboundWork(run({ reportRef: 'SR-1042' }), [pass('1')], []);
    expect(plan.items[0]!.payload.note).toContain('SR-1042');
    expect(plan.items[0]!.payload.fullRecordAt).toContain('SR-1042');
  });

  it('says an asset could not be identified rather than sending an internal id', () => {
    const plan = planOutboundWork(run(), [
      { assetId: 'internal-uuid-99', outcome: 'pass' },
    ], []);
    expect(plan.warnings.map((w) => w.code)).toContain('asset-unidentified');
    expect(plan.items[0]!.payload.note).not.toContain('internal-uuid-99');
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
    expect(plan.items[0]!.payload.note).toContain('$450');
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
    expect(plan.items[0]!.payload.note).toContain('reason not recorded');
  });

  it('counts a passed asset but never lists it, so the not-tested list survives', () => {
    /*
     * Forty lines of "passed" push the not-tested list past the size limit, and
     * the not-tested list is the one thing on this note that must not be lost.
     */
    const plan = planOutboundWork(run(), Array.from({ length: 40 }, (_, i) => pass(String(i + 1))), []);
    expect(plan.items[0]!.payload.note).toContain('40 passed');
    expect(plan.items[0]!.payload.note).not.toContain('#37');
    expect(plan.items[0]!.payload.truncated).toBe(false);
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
    const item = plan.items[0]!;
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
    const item = plan.items[0]!;
    expect(keysInNoteText(item.payload.note)).toContain(item.key);
  });

  it('gives a queue row a line a person can act on without opening it', () => {
    const plan = planOutboundWork(run(), [pass('1'), pass('2', { outcome: 'fail' })], []);
    expect(plan.items[0]!.description).toContain('An Example Building');
    expect(plan.items[0]!.description).toContain('JOB-1');
    expect(plan.items[0]!.description).toContain('1 failed');
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
    const note = busy().items[1]!.payload.note;
    expect(note).toContain('Tested 31: 30 passed, 1 failed');
    expect(note).toContain('Not tested: 9');
    expect(note).toContain('No access to tenancy (9)');
  });

  it('never lets a visit with untested assets read as complete', () => {
    /*
     * The failure this whole module exists for: "service complete" on a job
     * that was nine assets short, invoiced in full because the note said so.
     */
    const note = busy().items[1]!.payload.note;
    expect(note).not.toMatch(/service complete/i);
    expect(note).toContain('9 of 40 assets were NOT tested');
    expect(note).toContain('The routine is not complete for those assets.');
  });

  it('says every asset was tested only when that is true', () => {
    const clean = planOutboundWork(run(), [pass('1'), pass('2')], []);
    expect(clean.items[0]!.payload.note).toContain('Every asset with a result recorded on this visit was tested.');
    expect(busy().items[1]!.payload.note).not.toContain('was tested. An asset nobody reached');
  });

  it("does not claim more than it can see, because it never gets the routine's register", () => {
    /*
     * The module is handed the assets that got a result, not the assets the
     * routine covers. Ten detectors nobody reached produce no rows at all, so an
     * unqualified "every asset was tested" would be the same lie in a quieter
     * voice — read as a complete routine and invoiced as one.
     */
    const note = planOutboundWork(run(), [pass('1'), pass('2')], []).items[0]!.payload.note;
    expect(note).toContain('An asset nobody reached carries no result and is not counted above.');
    expect(note).not.toMatch(/every asset (on this visit )?was tested/i);
  });

  it('puts the critical defect above the other defects and the failures in the note', () => {
    // A critical defect four screens down gets read on Monday, by which time the
    // 24-hour written notice is already late.
    const note = busy().items[1]!.payload.note;
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
    const note = busy().items[0]!.payload.note;
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
    const note = wordyReasons().items[1]!.payload.note;
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
    const note = wordyReasons().items[1]!.payload.note;
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
    const note = plan.items[0]!.payload.note;
    expect(note).toContain('Defects raised: 1');
    expect(note).toContain('A further 1 defect was raised on this visit and already reported to the office');
  });

  it('writes the same note whichever order the result rows arrived in', () => {
    // Two phones on the same visit produce the same words, so a duplicate in the
    // office is recognisable by eye as well as by key.
    const rows = [pass('10'), pass('2'), pass('1', { outcome: 'fail' })];
    const a = planOutboundWork(run(), rows, []).items[0]!.payload.note;
    const b = planOutboundWork(run(), [...rows].reverse(), []).items[0]!.payload.note;
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
    for (const item of plan.items) {
      expect(item.payload.note.length).toBeLessThanOrEqual(1500);
      expect(keysInNoteText(item.payload.note)).toContain(item.key);
    }
    // The two things that must survive a cut, whatever else goes.
    expect(plan.items[1]!.payload.note).toContain('Not tested: 120');
    expect(plan.items[1]!.payload.note).toContain('*** CRITICAL DEFECT ***');
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
    const existing = plan.items[0]!;
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
        { Subject: 'Service', Note: plan.items[1]!.payload.note },
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
      notes: [jobNote(plan.items[0]!.payload.note)],
    });
    const report = await sendOutboundPlan(client as never, plan);
    expect(report.skipped).toBeGreaterThan(0);
    expect(report.sent).toBe(0);
  });
});
