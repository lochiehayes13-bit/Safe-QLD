import {
  KIND_MEANING, NOT_A_SERVICE_RECORD, findingRef, openDefectCaution, openDefectReportNote, parseFindingRef,
  recommendationClosing, recommendationList, renumber, summariseFindings, validateFindings, type Finding,
} from '@/domain/findings';

/**
 * Findings on an effectiveness assessment.
 *
 * The failure this guards against is a category error rather than an arithmetic
 * one: a recommendation that becomes a defect starts statutory clocks that have
 * no business running, and a report that recommends five things while listing
 * three gets a project quoted short.
 *
 * The worked example is Safe QLD's own issued report — five recommendations and
 * three observations at a water treatment plant admin building.
 */

const finding = (over: Partial<Finding> & Pick<Finding, 'id' | 'kind' | 'seq'>): Finding => ({
  assessmentId: 'a1',
  item: 'An item',
  location: 'Somewhere',
  detail: 'Something was seen.',
  action: 'Do something about it.',
  priority: over.kind === 'recommendation' ? 'high' : undefined,
  relatedRefs: [],
  photos: [],
  createdAt: '2026-07-03T00:00:00.000Z',
  updatedAt: '2026-07-03T00:00:00.000Z',
  ...over,
});

describe('findingRef', () => {
  it('numbers the way the report prints', () => {
    expect(findingRef('recommendation', 1)).toBe('R-01');
    expect(findingRef('recommendation', 5)).toBe('R-05');
    expect(findingRef('observation', 3)).toBe('OBS-03');
    expect(findingRef('recommendation', 12)).toBe('R-12');
  });

  it('reads a reference back, however it was typed', () => {
    expect(parseFindingRef('R-01')).toEqual({ kind: 'recommendation', seq: 1 });
    expect(parseFindingRef('r01')).toEqual({ kind: 'recommendation', seq: 1 });
    expect(parseFindingRef('OBS-03')).toEqual({ kind: 'observation', seq: 3 });
    expect(parseFindingRef('D-01')).toBeUndefined();
    expect(parseFindingRef('R-00')).toBeUndefined();
    expect(parseFindingRef('')).toBeUndefined();
  });
});

describe('renumber', () => {
  it('runs each kind from one without gaps', () => {
    // A register that jumps from R-02 to R-04 reads as a finding pulled before
    // issue, and a client asks what it was.
    const out = renumber([
      finding({ id: 'a', kind: 'recommendation', seq: 2 }),
      finding({ id: 'b', kind: 'observation', seq: 9 }),
      finding({ id: 'c', kind: 'recommendation', seq: 7 }),
    ]);
    expect(out.map((f) => findingRef(f.kind, f.seq))).toEqual(['R-01', 'R-02', 'OBS-01']);
  });

  it('puts recommendations before observations, as the register does', () => {
    const out = renumber([
      finding({ id: 'a', kind: 'observation', seq: 1 }),
      finding({ id: 'b', kind: 'recommendation', seq: 1 }),
    ]);
    expect(out.map((f) => f.id)).toEqual(['b', 'a']);
  });

  it('keeps the order the technician put them in within a kind', () => {
    const out = renumber([
      finding({ id: 'speakers', kind: 'recommendation', seq: 3 }),
      finding({ id: 'panel', kind: 'recommendation', seq: 1 }),
    ]);
    expect(out.map((f) => f.id)).toEqual(['speakers', 'panel']);
    expect(out.map((f) => f.seq)).toEqual([1, 2]);
  });

  it('returns the same objects when nothing needs moving', () => {
    const a = finding({ id: 'a', kind: 'recommendation', seq: 1 });
    expect(renumber([a])[0]).toBe(a);
  });
});

describe('validateFindings', () => {
  it('passes a well-formed register', () => {
    expect(validateFindings([
      finding({ id: 'a', kind: 'recommendation', seq: 1 }),
      finding({ id: 'b', kind: 'observation', seq: 1, priority: undefined }),
    ])).toEqual([]);
  });

  it('refuses an observation carrying a priority', () => {
    // An observation is note-only. Urgency contradicts what it is.
    const issues = validateFindings([
      finding({ id: 'b', kind: 'observation', seq: 1, priority: 'high' }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe("OBS-01 is an observation, so it can't have a priority.");
  });

  it('wants a priority on every recommendation', () => {
    const issues = validateFindings([
      finding({ id: 'a', kind: 'recommendation', seq: 1, priority: undefined }),
    ]);
    expect(issues.map((i) => i.message).join(' ')).toContain('no priority');
  });

  it('catches a recommendation with nothing to do about it', () => {
    const issues = validateFindings([
      finding({ id: 'a', kind: 'recommendation', seq: 1, action: '  ' }),
    ]);
    expect(issues[0]!.message).toBe('R-01 has no action.');
  });

  it('catches a cross-reference to a finding that is not in the report', () => {
    const issues = validateFindings([
      finding({ id: 'a', kind: 'recommendation', seq: 1, relatedRefs: ['R-09'] }),
    ]);
    expect(issues[0]!.message).toContain('R-09');
    expect(issues[0]!.message).toContain('not in this report');
  });

  it('accepts a cross-reference that resolves', () => {
    expect(validateFindings([
      finding({ id: 'a', kind: 'recommendation', seq: 1 }),
      finding({ id: 'b', kind: 'recommendation', seq: 2, relatedRefs: ['R-01'] }),
    ])).toEqual([]);
  });

  it('catches a reference that is not a reference at all', () => {
    const issues = validateFindings([
      finding({ id: 'a', kind: 'recommendation', seq: 1, relatedRefs: ['see the panel'] }),
    ]);
    expect(issues[0]!.message).toContain('not a finding reference');
  });

  it('catches a duplicated number', () => {
    const issues = validateFindings([
      finding({ id: 'a', kind: 'recommendation', seq: 1 }),
      finding({ id: 'b', kind: 'recommendation', seq: 1 }),
    ]);
    expect(issues.map((i) => i.message).join(' ')).toContain('used twice');
  });

  it('names every blank field rather than only the first', () => {
    const issues = validateFindings([
      finding({ id: 'a', kind: 'recommendation', seq: 1, item: '', detail: '', location: '' }),
    ]);
    const text = issues.map((i) => i.message).join(' ');
    expect(text).toContain('no item name');
    expect(text).toContain('no detail');
    expect(text).toContain('no location');
  });
});

describe('summariseFindings', () => {
  it('counts the register the report issued', () => {
    const findings = [
      ...[1, 2, 3, 4, 5].map((n) => finding({ id: `r${n}`, kind: 'recommendation', seq: n })),
      ...[1, 2, 3].map((n) => finding({ id: `o${n}`, kind: 'observation', seq: n, priority: undefined })),
    ];
    expect(summariseFindings(findings)).toEqual({
      recommendations: 5, observations: 3, high: 5, none: false,
    });
  });

  it('treats an empty register as a real outcome, not a missing one', () => {
    expect(summariseFindings([]).none).toBe(true);
  });
});

describe('recommendationList', () => {
  it('builds the closing statement from the register itself', () => {
    // The issued report ends by enumerating what the project should
    // incorporate. Written by hand that list drifts; built from the register it
    // cannot.
    const list = recommendationList([
      finding({ id: 'a', kind: 'recommendation', seq: 1, item: 'Replacement of the superseded AFP-2800 FIP.' }),
      finding({ id: 'b', kind: 'recommendation', seq: 2, item: 'Programmed replacement of the detection fleet' }),
      finding({ id: 'c', kind: 'observation', seq: 1, item: 'East offices', priority: undefined }),
    ]);
    expect(list).toBe(
      '(1) Replacement of the superseded AFP-2800 FIP; (2) Programmed replacement of the detection fleet',
    );
  });

  it('is empty when nothing is recommended', () => {
    expect(recommendationList([finding({ id: 'o', kind: 'observation', seq: 1, priority: undefined })])).toBe('');
  });
});

describe('recommendationClosing', () => {
  it('lists the recommendations without assuming a project is coming', () => {
    const closing = recommendationClosing([
      finding({ id: 'a', kind: 'recommendation', seq: 1, item: 'Replacement of the FIP' }),
      finding({ id: 'b', kind: 'recommendation', seq: 2, item: 'Replacement of the detection fleet' }),
    ]);
    expect(closing).toBe('Recommended improvements: (1) Replacement of the FIP; (2) Replacement of the detection fleet.');
    expect(closing).not.toMatch(/project/i);
  });

  it('is empty when nothing is recommended', () => {
    expect(recommendationClosing([finding({ id: 'o', kind: 'observation', seq: 1, priority: undefined })])).toBe('');
  });

  it('keeps the classification key free of the same assumption', () => {
    expect(KIND_MEANING.recommendation).not.toMatch(/upcoming project/i);
  });
});

describe('openDefectCaution', () => {
  it('says nothing when the site has no open defects', () => {
    expect(openDefectCaution(0, 0)).toBeUndefined();
  });

  it('tells the technician what to do about them', () => {
    const note = openDefectCaution(4, 0)!;
    expect(note).toContain('4 open defects');
    expect(note).toContain('Mention them in the report');
  });

  it('calls out the critical ones separately', () => {
    expect(openDefectCaution(4, 1)).toContain('1 of them is critical');
    expect(openDefectCaution(4, 2)).toContain('2 of them are critical');
  });
});

describe('openDefectReportNote', () => {
  it('says nothing when the site has no open defects', () => {
    expect(openDefectReportNote(0, 0)).toBeUndefined();
  });

  it('states the fact to the client without the instruction meant for the technician', () => {
    const note = openDefectReportNote(4, 1)!;
    expect(note).toContain('4 open defects already recorded');
    expect(note).toContain('1 of them is critical');
    expect(note).toContain('No equipment was tested');
    expect(note).not.toMatch(/fix them|mention them|say so/i);
  });
});

describe('the statements the document makes about itself', () => {
  it('never lets the report be mistaken for a service record', () => {
    expect(NOT_A_SERVICE_RECORD).toContain('does not constitute an AS 1851:2012');
    expect(NOT_A_SERVICE_RECORD).toContain('Building Fire Safety Regulation 2008');
  });

  it('says plainly that a recommendation asserts no defect', () => {
    expect(KIND_MEANING.recommendation).toContain('No defect exists');
    expect(KIND_MEANING.observation).toContain('no action required');
  });
});

describe('a finding is not a defect', () => {
  it('carries no severity and no statutory field to carry one into', () => {
    const f = finding({ id: 'a', kind: 'recommendation', seq: 1 });
    // Asserted structurally rather than by comment: if a severity is ever added
    // here, this fails and the reason gets thought about again.
    expect(Object.keys(f)).not.toContain('severity');
    expect(Object.keys(f)).not.toContain('as1851Class');
    expect(Object.keys(f)).not.toContain('noticeIssuedAt');
  });
});
