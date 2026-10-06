/**
 * The order to walk a Form 72 in, and what is still outstanding on it.
 *
 * Two things are worth proving here beyond the mapping itself.
 *
 * That it never answers anything. The whole value of this module is that it
 * decides what a technician is ASKED, and an applicability map that quietly
 * marked a part N/A would be the defect it exists to prevent: a part nobody
 * opened already prints N/A exactly like a part somebody marked N/A on
 * purpose, and that is the one thing a reader of the printed form cannot tell
 * apart.
 *
 * And that it is not wired into validateForm72. form72Html runs that
 * validation on issued forms as well as drafts, so a blocking rule added there
 * stamps "DRAFT — NOT FOR ISSUE" across forms that were signed and handed to an
 * occupier months ago. The last test in this file is a guard on that.
 */
import {
  GUIDE_ORDER, guideSteps, nextGuideStep, outstandingParts, partAnswered, recordAnswered,
  type Applicability, type GuidePart,
} from '@/domain/form72Guide';
import {
  PART_D_ROWS, emptyForm72, flowRowUntouched, validateForm72,
  type FlowRow, type Form72, type MaintenanceTest,
} from '@/domain/form72';

const NOW = '2026-10-06T00:00:00.000Z';

const blankAxes: MaintenanceTest = {
  hydrantAnnual: false, hydrantFiveYear: false,
  sprinklerAnnual: false, sprinklerFiveYear: false,
  combinedAnnual: false, combinedFiveYear: false,
};

const form = (p: Partial<Form72> = {}): Form72 => ({
  ...emptyForm72({ id: 'f', siteId: 's', siteName: 'Site', contractor: 'Safe QLD', now: NOW }),
  ...p,
});

const hydrantAnnual = () => form({
  maintenanceTest: { ...blankAxes, hydrantAnnual: true },
});
const sprinklerAnnual = () => form({
  maintenanceTest: { ...blankAxes, sprinklerAnnual: true },
});
const combined = () => form({
  maintenanceTest: { ...blankAxes, combinedAnnual: true },
});

const state = (f: Form72, part: GuidePart): Applicability =>
  guideSteps(f).find((s) => s.part === part)!.applies;

describe('the order the form is walked in', () => {
  it('covers every part exactly once', () => {
    expect([...GUIDE_ORDER].sort()).toEqual(
      ['A', 'Attachment', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
    );
  });

  it('puts the equipment before the readings taken with it', () => {
    // Part D names a device per row from Part C's list — its own column head
    // says "Device/gauge no. (Part C)" — so Part C first is not a preference.
    expect(GUIDE_ORDER.indexOf('C')).toBeLessThan(GUIDE_ORDER.indexOf('D'));
    expect(GUIDE_ORDER.indexOf('C')).toBeLessThan(GUIDE_ORDER.indexOf('E'));
  });

  it('puts the signature last of all', () => {
    expect(GUIDE_ORDER[GUIDE_ORDER.length - 1]).toBe('I');
  });

  it('starts with the part that decides the rest', () => {
    expect(GUIDE_ORDER[0]).toBe('A');
  });

  it('describes every part, in one state each, with a reason', () => {
    for (const f of [form(), hydrantAnnual(), sprinklerAnnual(), combined()]) {
      const steps = guideSteps(f);
      expect(steps.map((s) => s.part).sort()).toEqual([...GUIDE_ORDER].sort());
      for (const s of steps) expect(s.why.length).toBeGreaterThan(30);
    }
  });
});

describe('an annual hydrant test, which is the commonest form this company raises', () => {
  const f = hydrantAnnual();

  it('asks for the hydrant parts', () => {
    expect(state(f, 'C')).toBe('this-system');
    expect(state(f, 'D')).toBe('this-system');
  });

  it('leaves the hydrostatic test to the technician, as the form does', () => {
    // "Refer to the required pressure specification for periodic testing (as
    // applicable)". The form declines to decide, so this declines too.
    expect(state(f, 'B')).toBe('ask');
  });

  it('rules out both sprinkler parts, which is two screens of empty boxes', () => {
    expect(state(f, 'F')).toBe('not-this-system');
    expect(state(f, 'G')).toBe('not-this-system');
  });

  it('still asks about the booster, because the form does not know if there is one', () => {
    expect(state(f, 'E')).toBe('ask');
  });

  it('asks Parts A, H and I of every form', () => {
    for (const part of ['A', 'H', 'I'] as GuidePart[]) {
      expect({ part, applies: state(f, part) }).toEqual({ part, applies: 'always' });
    }
  });

  it('never calls the attachment page part of the department’s form', () => {
    expect(state(f, 'Attachment')).toBe('optional');
  });
});

describe('an annual sprinkler test', () => {
  const f = sprinklerAnnual();

  it('rules out the hydrant pipework and flow parts', () => {
    expect(state(f, 'B')).toBe('not-this-system');
    expect(state(f, 'D')).toBe('not-this-system');
  });

  it('asks for both sprinkler parts', () => {
    expect(state(f, 'F')).toBe('this-system');
    expect(state(f, 'G')).toBe('this-system');
  });

  it('makes the hydrant equipment list optional rather than ruled out', () => {
    // Part C is headed "Hydrant test equipment/pressure gauges", so it is not
    // this test's part — but a gauge used on a sprinkler test point is still
    // worth recording, and ruling it out would stop the app offering it.
    expect(state(f, 'C')).toBe('optional');
  });
});

describe('a combined system, which is both', () => {
  const f = combined();

  it('asks for the hydrant parts and the sprinkler parts', () => {
    expect(state(f, 'D')).toBe('this-system');
    expect(state(f, 'F')).toBe('this-system');
    expect(state(f, 'G')).toBe('this-system');
    expect(state(f, 'C')).toBe('this-system');
  });

  it('rules nothing out', () => {
    expect(guideSteps(f).filter((s) => s.applies === 'not-this-system')).toEqual([]);
  });
});

describe('a form where Part A has not been answered yet', () => {
  const f = form();

  it('rules nothing out, because Part A is the thing that would rule it out', () => {
    expect(guideSteps(f).filter((s) => s.applies === 'not-this-system')).toEqual([]);
  });

  it('says that is why, rather than leaving a part looking irrelevant', () => {
    for (const part of ['B', 'D', 'F', 'G'] as GuidePart[]) {
      expect(guideSteps(f).find((s) => s.part === part)!.why)
        .toContain('Part A does not say yet');
    }
  });

  it('sends the technician to Part A first', () => {
    expect(nextGuideStep(f)?.part).toBe('A');
  });
});

describe('where Next goes', () => {
  it('skips a part Part A has ruled out', () => {
    const f = hydrantAnnual();
    // After Part E on a hydrant test, F and G are out, so H is next.
    expect(nextGuideStep(f, 'E')?.part).toBe('H');
  });

  it('skips the attachment page, which is not the department’s form', () => {
    const f = { ...hydrantAnnual(), systemResult: 'pass' as const };
    expect(nextGuideStep(f, 'H')?.part).toBe('I');
  });

  it('does not skip a part the form leaves to the technician', () => {
    // An unasked question that defaults to N/A is the failure this prevents,
    // so 'ask' is never skipped however little the app knows about it.
    const f = hydrantAnnual();
    expect(nextGuideStep(f, 'A')?.part).toBe('C');
    expect(nextGuideStep(f, 'C')?.part).toBe('B');
  });

  it('skips a part that has already been answered', () => {
    const f = form({
      maintenanceTest: { ...blankAxes, hydrantAnnual: true },
      devices: [{ slot: 'Device/gauge 1', serialNumber: 'SQF-001' }],
    });
    expect(nextGuideStep(f, 'A')?.part).toBe('B');
  });

  it('runs out rather than looping, on a form with nothing left', () => {
    const f = form({
      maintenanceTest: { ...blankAxes, hydrantAnnual: true },
      testDate: '2026-10-02',
      devices: [{ slot: 'Device/gauge 1', serialNumber: 'SQF-001' }],
      hydrostatic: { result: 'pass' },
      flowTest: { result: 'pass', hydrantLocations: [], rows: [] },
      booster: { result: 'na' },
      systemResult: 'pass',
      licenceNumber: '1310717',
      signature: 'data:image/png;base64,AAA',
    });
    // Part E is 'ask' and unanswered, so it is still outstanding — which is the
    // point. Answer it and nothing is left.
    expect(nextGuideStep(f, 'D')?.part).toBe('E');
    expect(nextGuideStep({ ...f, booster: { result: 'pass' } }, 'D')).toBeUndefined();
  });

  it('starts from the top when asked without a part', () => {
    expect(nextGuideStep(hydrantAnnual())?.part).toBe('A');
  });

  it('answers nothing after the last part', () => {
    expect(nextGuideStep(hydrantAnnual(), 'I')).toBeUndefined();
  });
});

describe('what is outstanding', () => {
  it('lists the parts that apply and have nothing on them, in walking order', () => {
    expect(outstandingParts(hydrantAnnual()).map((s) => s.part))
      .toEqual(['A', 'C', 'B', 'D', 'E', 'H', 'I']);
  });

  it('leaves out the sprinkler parts on a hydrant test', () => {
    expect(outstandingParts(hydrantAnnual()).map((s) => s.part)).not.toContain('F');
  });

  it('never calls the attachment page outstanding', () => {
    for (const f of [form(), hydrantAnnual(), sprinklerAnnual(), combined()]) {
      expect(outstandingParts(f).map((s) => s.part)).not.toContain('Attachment');
    }
  });

  it('shortens as parts get answered', () => {
    const f = hydrantAnnual();
    const before = outstandingParts(f).length;
    const after = outstandingParts({ ...f, hydrostatic: { result: 'fail' } }).length;
    expect(after).toBe(before - 1);
  });

  it('counts a part marked N/A as answered, because N/A is an answer', () => {
    /*
     * The technician said it does not apply. That is a statement they made,
     * and the page prints it as one — so the list must stop naming it. It can
     * only know this from answeredParts: the stored result is 'na' either way,
     * which is the whole reason that column exists.
     */
    const f = { ...hydrantAnnual(), hydrostatic: { result: 'na' as const }, answeredParts: ['B'] };
    expect(partAnswered(f, 'B')).toBe(true);
    expect(outstandingParts(f).map((s) => s.part)).not.toContain('B');
  });

  it('still names a part nobody opened, whose result reads the same', () => {
    // Same stored 'na', no record of anybody answering it. This is the case
    // the printed form cannot distinguish and the technician needs to see.
    const f = { ...hydrantAnnual(), hydrostatic: { result: 'na' as const } };
    expect(partAnswered(f, 'B')).toBe(false);
    expect(outstandingParts(f).map((s) => s.part)).toContain('B');
  });

  it('falls back to the part’s contents on a form written before the column', () => {
    const f = hydrantAnnual();
    expect(f.answeredParts).toBeUndefined();
    expect(partAnswered({ ...f, hydrostatic: { result: 'pass' } }, 'B')).toBe(true);
    expect(partAnswered(f, 'B')).toBe(false);
  });
});

describe('recording that a part was answered', () => {
  it('adds a part that is not recorded yet', () => {
    expect(recordAnswered(hydrantAnnual(), 'B')).toEqual({ answeredParts: ['B'] });
  });

  it('keeps the parts already recorded', () => {
    const f = { ...hydrantAnnual(), answeredParts: ['A', 'C'] };
    expect(recordAnswered(f, 'B')).toEqual({ answeredParts: ['A', 'C', 'B'] });
  });

  it('writes nothing for a part already recorded', () => {
    // A result picker tapped twice must not write twice.
    const f = { ...hydrantAnnual(), answeredParts: ['B'] };
    expect(recordAnswered(f, 'B')).toBeUndefined();
  });

  it('never takes a part back out', () => {
    /*
     * An answer changed from pass to N/A is still an answer, and a technician
     * who clears a reading has still looked at the part. Removing it would put
     * the part back on the outstanding list for somebody who had dealt with it.
     */
    const f = { ...hydrantAnnual(), answeredParts: ['B', 'D'] };
    expect(recordAnswered(f, 'D')).toBeUndefined();
    expect(recordAnswered(f, 'E')!.answeredParts).toEqual(['B', 'D', 'E']);
  });
});

describe('Part D’s eight rows, folded', () => {
  /*
   * The department's table prints three nozzle bores and five metered rates
   * whatever the job did, so all eight have to be on the screen and all eight
   * have to stay answerable — a row nobody can reach is a reading nobody can
   * take. A typical annual hydrant test runs three, and eight full cards put
   * five of them between the technician and the next one they want.
   *
   * The fold follows what is ON the row and never what the app guesses the job
   * was, which is the property worth pinning. These are the predicates the
   * screen folds on; form72.test.ts holds the other half — that folding a row
   * away changes nothing about what the page prints.
   */
  const row = (over: Partial<FlowRow> = {}): FlowRow => ({ nozzleMm: 19, devices: '', ...over });

  it('treats a row with nothing on it as not in use', () => {
    expect(flowRowUntouched(row())).toBe(true);
  });

  it('treats a row with one reading as in use, from the first keystroke', () => {
    expect(flowRowUntouched(row({ hydrant1Kpa: 540 }))).toBe(false);
  });

  it('treats a row with only a meter named as in use, because that is a gap', () => {
    // Naming the meter is what turns the page's "Not run" into "Not recorded",
    // so the row has to be open where the technician can see it.
    expect(flowRowUntouched(row({ devices: 'SQF-001' }))).toBe(false);
  });

  it('counts the department’s eight rows by what is on them', () => {
    const lines = PART_D_ROWS.map((r) => ({ ...r }));
    expect(lines.filter((r) => !flowRowUntouched(r))).toHaveLength(0);
    const run = [{ ...lines[0]!, hydrant1Kpa: 600 }, { ...lines[3]!, hydrant1Kpa: 580 }];
    expect(run.filter((r) => !flowRowUntouched(r))).toHaveLength(2);
  });

});

describe('what this module must never do', () => {
  it('changes nothing on the form it is given', () => {
    const f = hydrantAnnual();
    const before = JSON.stringify(f);
    guideSteps(f);
    nextGuideStep(f);
    outstandingParts(f);
    expect(JSON.stringify(f)).toBe(before);
  });

  it('is not read by validateForm72, so it cannot reach a form already signed', () => {
    /*
     * form72Html validates issued forms as well as drafts, so anything
     * blocking that this module taught the validation would stamp "DRAFT — NOT
     * FOR ISSUE" across documents that were signed and given to an occupier
     * months ago. The guard is the module's own text: the validation must not
     * mention it.
     */
    const source = require('node:fs')
      .readFileSync(require.resolve('@/domain/form72'), 'utf8') as string;
    expect(source).not.toContain('form72Guide');
    expect(source).not.toContain('outstandingParts');
  });

  it('does not change what a form is allowed to be issued as', () => {
    // An outstanding part is advice. A form the validation would let somebody
    // issue is still issuable with five parts outstanding, because the
    // department's form allows a part to be left blank and the page says so.
    const f = form({
      maintenanceTest: { ...blankAxes, hydrantAnnual: true },
      testDate: '2026-10-02',
      systemResult: 'pass',
      criticalDefectsIdentified: false,
      repairsRequired: false,
      licenseeName: 'D. McKee',
      licenceNumber: '1310717',
      signature: 'data:image/png;base64,AAA',
    });
    expect(outstandingParts(f).length).toBeGreaterThan(0);
    expect(validateForm72(f).filter((i) => i.blocking)).toEqual([]);
  });
});
