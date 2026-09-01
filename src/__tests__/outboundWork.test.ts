import {
  NOTE_LIMITS, WITHHELD_FROM_SIMPRO,
  isCriticalDefect, keyIdentity, keysInNoteText, outboundKey, planOutboundWork, qldDay, qldIsoDay,
  qldMoment, summariseRun, truncateOnSentence,
  type CompletedRoutineRun, type OutboundDefect, type OutboundResult,
} from '@/domain/outboundWork';

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

  it('keeps the reason in the technician\'s own words', () => {
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
