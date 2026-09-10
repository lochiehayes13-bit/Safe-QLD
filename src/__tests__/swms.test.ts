import {
  CONTROL_LEVEL_ORDER, SWMS_REVIEW_TRIGGERS, canSign, carryForwardSwms, mergeSwms, orderedControls,
  stepKey, stillCovers, suggestTemplates, swmsProgressLine, swmsTitleFor, validateSwms, whyNotSigned,
  worstRisk, type SwmsRecord, type SwmsTemplate,
} from '@/domain/swms';

/**
 * The rules a safe work method statement is held to.
 *
 * Three of them are the reason the module exists rather than a folder of PDFs:
 * a statement cannot be signed with a site question unanswered, a step unread
 * or a permit missing; signatures never carry forward to another day; and the
 * high-risk categories are named rather than implied.
 */

const HOT: SwmsTemplate = {
  id: 'hot-work',
  title: 'Hot work',
  activity: 'Cutting, grinding and welding on site',
  hrcw: [{ clause: 's291(k)', text: 'Work carried out in an area with a contaminated or flammable atmosphere' }],
  whenRequired: 'Any time a flame, spark or hot surface is produced.',
  permits: ['Hot work permit'],
  ppe: ['Face shield', 'Leather gloves', 'Long sleeves'],
  training: ['Hot work awareness'],
  steps: [
    {
      step: 'Get the permit and isolate the detection',
      hazards: ['Unwanted alarm and brigade turnout'],
      initialRisk: 'high',
      controls: [
        { level: 'ppe', control: 'Face shield on before striking an arc' },
        { level: 'isolate', control: 'Isolate the affected zones at the panel and record the isolation' },
      ],
      residualRisk: 'low',
      responsible: 'Technician',
    },
    {
      step: 'Clear the area and post a fire watch',
      hazards: ['Ignition of nearby combustibles'],
      initialRisk: 'extreme',
      controls: [{ level: 'eliminate', control: 'Move combustibles more than 10 m away, or cut off site' }],
      residualRisk: 'medium',
      responsible: 'Second person',
    },
  ],
  emergency: 'Stop, use the extinguisher at the work area, ring 000, then de-isolate the panel.',
  references: ['Work Health and Safety Regulation 2011 (Qld)', 'AS 1674.1'],
  siteSpecificPrompts: ['Where is the nearest extinguisher?', 'Who holds the panel key?'],
  suggestFor: { words: ['weld', 'grind'] },
};

const HEIGHTS: SwmsTemplate = {
  id: 'heights',
  title: 'Working at height',
  activity: 'Ladders and elevated work platforms to reach ceiling devices',
  hrcw: [{ clause: 's291(a)', text: 'Work carried out where there is a risk of a person falling more than 2 m' }],
  whenRequired: 'Any work off the floor.',
  permits: [],
  ppe: ['Harness', 'Face shield'],
  training: ['EWP licence'],
  steps: [
    {
      step: 'Set up the platform',
      hazards: ['Falling', 'Dropped tools'],
      initialRisk: 'high',
      controls: [{ level: 'engineering', control: 'Use a platform ladder with handrails rather than a step ladder' }],
      residualRisk: 'medium',
      responsible: 'Technician',
    },
  ],
  emergency: 'Do not climb to a fallen worker. Ring 000 and use the EWP rescue lowering control.',
  references: ['AS/NZS 1891.4'],
  siteSpecificPrompts: ['Where is the nearest extinguisher?', 'What is under the work area?'],
  suggestFor: { systems: ['detection'], routineIds: ['det-annual'], words: ['ceiling'] },
};

const TEMPLATES = [HOT, HEIGHTS];

function record(over: Partial<SwmsRecord> = {}): SwmsRecord {
  return {
    id: 'r1',
    templateIds: ['hot-work', 'heights'],
    title: 'Hot work and 1 other',
    siteName: 'Fictional Tower',
    date: '2026-09-10',
    answers: {},
    addedHazards: [],
    ticked: [],
    ppeChecked: [],
    permits: [{ permit: 'Hot work permit', held: false }],
    workers: [],
    status: 'draft',
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    ...over,
  };
}

/** A record with everything a sign-off needs, so each test can take one thing away. */
function ready(over: Partial<SwmsRecord> = {}): SwmsRecord {
  const merged = mergeSwms(TEMPLATES);
  return record({
    answers: Object.fromEntries(merged.prompts.map((p) => [p, 'Answered on site'])),
    ticked: merged.steps.map((s) => s.key),
    ppeChecked: [...merged.ppe],
    permits: [{ permit: 'Hot work permit', held: true, reference: 'HW-114' }],
    workers: [{ name: 'Sam', signature: 'data:image/svg+xml;base64,AAA', signedAt: '2026-09-10T21:00:00.000Z' }],
    supervisor: 'Alex',
    ...over,
  });
}

describe('merging the day’s statements', () => {
  it('keeps every step, tagged with the statement it came from', () => {
    const merged = mergeSwms(TEMPLATES);
    expect(merged.steps.map((s) => s.key)).toEqual([stepKey('hot-work', 0), stepKey('hot-work', 1), stepKey('heights', 0)]);
    expect(merged.steps[2]!.templateTitle).toBe('Working at height');
  });

  it('collapses the lists a crew would otherwise read twice', () => {
    const merged = mergeSwms(TEMPLATES);
    // Face shield is on both statements, and the prompt about the extinguisher
    // is asked by both.
    expect(merged.ppe.filter((p) => p === 'Face shield')).toHaveLength(1);
    expect(merged.prompts.filter((p) => p.startsWith('Where is the nearest'))).toHaveLength(1);
    expect(merged.prompts).toHaveLength(3);
  });

  it('names the high-risk categories rather than implying them', () => {
    const merged = mergeSwms(TEMPLATES);
    expect(merged.highRisk).toBe(true);
    expect(merged.hrcw.map((h) => h.clause)).toEqual(['s291(k)', 's291(a)']);
  });

  it('reports the worst risk left after the controls, not the worst before them', () => {
    const merged = mergeSwms(TEMPLATES);
    // Before controls there is an extreme; after them the worst left is medium.
    expect(merged.residualRisk).toBe('medium');
    expect(worstRisk(['low', 'extreme', 'medium'])).toBe('extreme');
    expect(worstRisk([])).toBeUndefined();
  });

  it('is empty rather than broken when nothing has been chosen', () => {
    const merged = mergeSwms([]);
    expect(merged.steps).toEqual([]);
    expect(merged.highRisk).toBe(false);
    expect(merged.residualRisk).toBeUndefined();
  });
});

describe('the order controls are read in', () => {
  it('puts elimination before personal protective equipment, whatever order they were written in', () => {
    const ordered = orderedControls(HOT.steps[0]!.controls);
    expect(ordered.map((c) => c.level)).toEqual(['isolate', 'ppe']);
    expect(CONTROL_LEVEL_ORDER.eliminate).toBeLessThan(CONTROL_LEVEL_ORDER.ppe);
  });
});

describe('what stops a statement being signed', () => {
  const merged = mergeSwms(TEMPLATES);

  it('lets a complete one through', () => {
    expect(validateSwms(ready(), merged).filter((i) => i.blocking)).toEqual([]);
    expect(canSign(ready(), merged)).toBe(true);
    expect(whyNotSigned(ready(), merged)).toBeUndefined();
  });

  it('blocks on a site question nobody answered, because that is the part an office cannot write', () => {
    const r = ready({ answers: { 'Who holds the panel key?': 'Reception' } });
    expect(canSign(r, merged)).toBe(false);
    expect(whyNotSigned(r, merged)).toContain('Where is the nearest extinguisher?');
  });

  it('blocks on a step nobody read', () => {
    const r = ready({ ticked: [stepKey('hot-work', 0)] });
    expect(canSign(r, merged)).toBe(false);
    expect(whyNotSigned(r, merged)).toContain('2 steps not read');
  });

  it('blocks on a permit the crew has not got', () => {
    const r = ready({ permits: [{ permit: 'Hot work permit', held: false }] });
    expect(canSign(r, merged)).toBe(false);
    expect(whyNotSigned(r, merged)).toContain('No Hot work permit');
  });

  it('blocks on a name with no signature, rather than printing a person who never saw it', () => {
    const r = ready({ workers: [{ name: 'Sam', signature: 'data:x' }, { name: 'Jordan' }] });
    expect(canSign(r, merged)).toBe(false);
    expect(whyNotSigned(r, merged)).toContain('Jordan has not signed');
  });

  it('blocks when nobody at all has signed', () => {
    expect(whyNotSigned(ready({ workers: [] }), merged)).toContain('Nobody has signed');
  });

  it('warns without blocking on the things that are only awkward', () => {
    const r = ready({ ppeChecked: [], supervisor: undefined });
    expect(canSign(r, merged)).toBe(true);
    const advisory = validateSwms(r, merged).filter((i) => !i.blocking).map((i) => i.what);
    expect(advisory).toEqual(expect.arrayContaining([
      expect.stringContaining('PPE not confirmed'),
      'No supervisor named',
      'Not linked to a Simpro job',
    ]));
  });

  it('blocks a statement with no site on it, because a statement covers a place', () => {
    expect(whyNotSigned(ready({ siteName: '  ' }), merged)).toContain('No site');
  });
});

describe('the same work tomorrow', () => {
  it('carries what describes the work', () => {
    const yesterday = ready({ jobExternalId: '1001', jobTitle: 'Annual routine', addedHazards: [{ hazard: 'Scaffold in the way', control: 'Worked around it' }] });
    const { record: next } = carryForwardSwms(yesterday, '2026-09-11');
    expect(next.date).toBe('2026-09-11');
    expect(next.templateIds).toEqual(['hot-work', 'heights']);
    expect(next.answers).toEqual(yesterday.answers);
    expect(next.addedHazards).toEqual(yesterday.addedHazards);
    expect(next.ppeChecked).toEqual(yesterday.ppeChecked);
    expect(next.jobExternalId).toBe('1001');
    expect(next.workers.map((w) => w.name)).toEqual(['Sam']);
  });

  it('never carries a signature, a tick, or a spent permit', () => {
    const { record: next, cleared } = carryForwardSwms(ready(), '2026-09-11');
    expect(next.workers.every((w) => !w.signature && !w.signedAt)).toBe(true);
    expect(next.ticked).toEqual([]);
    expect(next.permits.every((p) => !p.held)).toBe(true);
    // The permit's number is kept, because it is a fact about the site.
    expect(next.permits[0]!.reference).toBe('HW-114');
    expect(next.status).toBe('draft');
    expect(cleared.length).toBeGreaterThanOrEqual(3);
  });

  it('deep-copies, so editing tomorrow does not rewrite yesterday', () => {
    const yesterday = ready({ addedHazards: [{ hazard: 'Wet floor', control: 'Signed off' }] });
    const { record: next } = carryForwardSwms(yesterday, '2026-09-11');
    next.addedHazards[0]!.hazard = 'Something else';
    next.answers['Who holds the panel key?'] = 'Changed';
    expect(yesterday.addedHazards[0]!.hazard).toBe('Wet floor');
    expect(yesterday.answers['Who holds the panel key?']).toBe('Answered on site');
  });
});

describe('choosing the statements for the day', () => {
  it('suggests by what is on the register and what is due', () => {
    expect(suggestTemplates(TEMPLATES, { systems: ['detection'] })).toEqual(['heights']);
    expect(suggestTemplates(TEMPLATES, { routineIds: ['det-annual'] })).toEqual(['heights']);
  });

  it('suggests by what the job is called', () => {
    expect(suggestTemplates(TEMPLATES, { text: 'Weld a new bracket in the plant room' })).toEqual(['hot-work']);
    expect(suggestTemplates(TEMPLATES, { text: 'Ceiling detectors and welding' })).toEqual(['hot-work', 'heights']);
  });

  it('suggests nothing rather than guessing when it knows nothing', () => {
    expect(suggestTemplates(TEMPLATES, {})).toEqual([]);
    expect(suggestTemplates(TEMPLATES, { text: '' })).toEqual([]);
  });
});

describe('the words on the screens', () => {
  it('counts the reading and the signing', () => {
    const merged = mergeSwms(TEMPLATES);
    expect(swmsProgressLine(record(), merged)).toBe('0 of 3 steps read');
    expect(swmsProgressLine(ready(), merged)).toBe('3 of 3 steps read · 1 of 1 signed');
  });

  it('titles a day by its statements', () => {
    expect(swmsTitleFor([])).toBe('Safe work method statement');
    expect(swmsTitleFor([HOT])).toBe('Hot work');
    expect(swmsTitleFor(TEMPLATES)).toBe('Hot work and 1 other');
  });

  it('says a signed statement covers today and not tomorrow', () => {
    const signed = ready({ status: 'signed' });
    expect(stillCovers(signed, '2026-09-10')).toBe(true);
    expect(stillCovers(signed, '2026-09-11')).toBe(false);
    expect(stillCovers(ready(), '2026-09-10')).toBe(false);
    expect(SWMS_REVIEW_TRIGGERS.length).toBeGreaterThan(3);
  });
});
