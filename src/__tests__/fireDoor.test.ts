import {
  DOOR_TYPES,
  FLOOR_MAX_CARPET_PENDING_MM,
  FLOOR_MAX_OVER_NON_COMBUSTIBLE_SILL_MM,
  FRL_ELEMENTS,
  GAP_LIMITS,
  SIGN_MIN_LETTER_HEIGHT_MM,
  SLIDING_FACE_ANY_POINT_MAX_MM,
  SOURCES,
  TAG_DEFECT_CODE,
  TAG_PARTICULARS,
  TAG_REQUIRED_FROM,
  TAG_REQUIRED_FROM_SUPERSEDED,
  UNSOURCED_GAPS,
  USUAL_GRADING_PERIODS,
  assessClosing,
  assessDoor,
  assessTag,
  checkGap,
  citeSources,
  compareFrl,
  explainFrl,
  formatAuDate,
  formatFrl,
  frlElementAt,
  latchingApplies,
  parseAuDate,
  parseFrl,
  requiredSignWording,
  summariseDoors,
  tagRequirement,
  type ClosingInput,
  type DoorInput,
  type FrlParsed,
  type FrlRefusal,
  type GapCheck,
  type TagParticulars,
} from '@/domain/fireDoor';

/**
 * Fire and smoke doors — a thousand assets and, until now, no logic.
 *
 * Almost everything asserted here is about refusing. The money on this system
 * is not lost to arithmetic; it is lost to "60/30" being quietly promoted to
 * "-/60/30" on a schedule, to a door that closes but does not latch being
 * written up as an observation, to a missing tag being recorded as a failed
 * door or as nothing at all, and to a trade clearance figure being quoted for a
 * configuration it was never written for. Every one of those has a test below
 * that fails the moment this module starts guessing.
 */

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

describe('sources', () => {
  it('gives every source a URL, a confidence and a reason for that confidence', () => {
    // A figure without provenance is a figure a technician cannot defend, and
    // the provenance has to live in the data rather than in a comment.
    for (const source of Object.values(SOURCES)) {
      expect(source.url).toMatch(/^https:\/\//);
      expect(source.ref.length).toBeGreaterThan(10);
      expect(source.basis.length).toBeGreaterThan(30);
      expect(['high', 'medium', 'low']).toContain(source.confidence);
    }
  });

  it('marks the second-hand trade measurement guidance as the weakest thing it relies on', () => {
    expect(SOURCES['trade-gap-method'].confidence).toBe('low');
    expect(SOURCES['trade-gap-method'].basis).toContain('not the standard');
  });

  it('records that the AS 1905.1 figures come from a superseded edition', () => {
    expect(SOURCES['as1905-1'].basis).toContain('2015');
    expect(SOURCES['as1905-1'].basis).toContain('superseded');
  });

  it('deduplicates a citation list while keeping report order', () => {
    const cited = citeSources(['as1905-1', 'qfd-fire-doors', 'as1905-1']);
    expect(cited.map((s) => s.id)).toEqual(['as1905-1', 'qfd-fire-doors']);
  });
});

// ---------------------------------------------------------------------------
// FRL notation
// ---------------------------------------------------------------------------

const parsed = (r: ReturnType<typeof parseFrl>): FrlParsed => {
  if (!r.ok) throw new Error(`expected a parse, got a refusal: ${r.reason}`);
  return r;
};
const refused = (r: ReturnType<typeof parseFrl>): FrlRefusal => {
  if (r.ok) throw new Error(`expected a refusal, got ${r.normalised}`);
  return r;
};

describe('FRL notation — which position is which', () => {
  it('puts structural adequacy, integrity and insulation in that order and nowhere else', () => {
    expect(FRL_ELEMENTS.map((e) => e.id)).toEqual(['structural-adequacy', 'integrity', 'insulation']);
    expect(FRL_ELEMENTS.map((e) => e.position)).toEqual([1, 2, 3]);
    expect(frlElementAt(2).id).toBe('integrity');
    expect(frlElementAt(3).label).toBe('Insulation');
  });

  it('explains -/60/30 element by element rather than as "a 60 minute door"', () => {
    // Reading -/60/30 as "60 minutes" overstates the criterion that decides
    // whether the far face of the leaf ignites what is leaning on it.
    const lines = explainFrl(parsed(parseFrl('-/60/30')).frl);
    expect(lines).toHaveLength(3);
    expect(lines[0]!.minutes).toBeUndefined();
    expect(lines[0]!.text).toContain('No structural adequacy requirement');
    expect(lines[1]!.text).toContain('60 minutes of integrity');
    expect(lines[2]!.text).toContain('30 minutes of insulation');
  });

  it('says what each criterion failing actually looks like in a fire', () => {
    const insulation = FRL_ELEMENTS[2]!;
    expect(insulation.failureLooksLike).toContain('without any flame');
  });
});

describe('parseFrl — the ordinary readings', () => {
  it('reads the form the register is full of', () => {
    const r = parsed(parseFrl('-/60/30'));
    expect(r.frl).toEqual({ structuralAdequacy: undefined, integrity: 60, insulation: 30 });
    expect(r.normalised).toBe('-/60/30');
    expect(r.confidence).toBe('high');
    expect(r.notes).toEqual([]);
  });

  it('reads a wall FRL with all three elements present', () => {
    const r = parsed(parseFrl('120/60/30'));
    expect(r.frl).toEqual({ structuralAdequacy: 120, integrity: 60, insulation: 30 });
    expect(r.normalised).toBe('120/60/30');
  });

  it('tolerates a leading FRL label, stray spaces and a keyed backslash', () => {
    expect(parsed(parseFrl('FRL -/60/30')).normalised).toBe('-/60/30');
    expect(parsed(parseFrl('FRL: - / 60 / 30')).normalised).toBe('-/60/30');
    const slashed = parsed(parseFrl('-\\60\\30'));
    expect(slashed.normalised).toBe('-/60/30');
    expect(slashed.notes.join(' ')).toContain('Backslashes');
  });

  it('reads an en dash as the no-requirement element and says it did', () => {
    // Word and a few register exports turn a hyphen into an en dash, and a
    // silent failure here would send a perfectly good door to a refusal.
    const r = parsed(parseFrl('–/60/30'));
    expect(r.frl.structuralAdequacy).toBeUndefined();
    expect(r.notes.join(' ')).toContain('dash');
  });

  it('formats back to the three-element form with dashes for absent elements', () => {
    expect(formatFrl({ integrity: 60, insulation: 30 })).toBe('-/60/30');
    expect(formatFrl({ structuralAdequacy: 240, integrity: 240, insulation: 240 })).toBe('240/240/240');
    expect(formatFrl({})).toBe('-/-/-');
  });

  it('round-trips every usual grading period', () => {
    for (const minutes of USUAL_GRADING_PERIODS) {
      const text = `-/${minutes}/${minutes}`;
      expect(parsed(parseFrl(text)).normalised).toBe(text);
    }
  });
});

describe('parseFrl — malformed input is refused, never repaired', () => {
  it("refuses the register's two-element shorthand instead of promoting it", () => {
    // Reading "60/30" as -/60/30 is right almost every time. The time it is
    // wrong, a door goes on a schedule understating a structural requirement,
    // so the likely reading comes back as a candidate and never as the answer.
    const r = refused(parseFrl('60/30'));
    expect(r.reason).toContain('two elements');
    expect(r.reason).toContain('three');
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]!.normalised).toBe('-/60/30');
    expect(r.whatToDo).toContain('door tag');
  });

  it('refuses an insulation period longer than the integrity period as impossible', () => {
    // Insulation is only assessed while integrity holds, so -/30/60 cannot have
    // been achieved on test. It is a transposition, and it is offered as one.
    const r = refused(parseFrl('-/30/60'));
    expect(r.reason).toContain('only assessed for as long as integrity holds');
    expect(r.candidates[0]!.normalised).toBe('-/60/30');
  });

  it('refuses an empty string with a reason a technician can act on', () => {
    const r = refused(parseFrl('   '));
    expect(r.reason).toContain('No fire-resistance level');
    expect(r.whatToDo).toContain('hinge stile');
    expect(r.candidates).toEqual([]);
  });

  it('refuses "n/a" as a statement that there is no figure rather than a figure', () => {
    for (const text of ['n/a', 'N/A', 'nil', 'None', 'unknown', '-']) {
      const r = refused(parseFrl(text));
      expect(r.reason).toContain('not a figure');
    }
  });

  it('refuses a four-element string and says what has probably been appended', () => {
    const r = refused(parseFrl('-/60/30/L1'));
    expect(r.reason).toContain('4 elements');
    expect(r.whatToDo).toContain('own column');
  });

  it('refuses a single number, which is what people mean by "a 60 minute door"', () => {
    const r = refused(parseFrl('60'));
    expect(r.reason).toContain('1 element');
    expect(r.whatToDo).toContain('-/60/30');
  });

  it('names the offending position when an element is not a number', () => {
    const r = refused(parseFrl('-/sixty/30'));
    expect(r.reason).toContain('integrity');
    expect(r.reason).toContain('position 2');
  });

  it('catches a letter typed where a digit belongs and offers the reading', () => {
    // "6O/30" off a phone keyboard is the classic, and refusing it blankly
    // sends the technician back up the stairwell for nothing.
    const r = refused(parseFrl('-/6O/30'));
    expect(r.reason).toContain('letter where a digit belongs');
    expect(r.reason).toContain('60');
  });

  it('refuses zero minutes, because no requirement is written "-" and not "0"', () => {
    const r = refused(parseFrl('0/60/30'));
    expect(r.reason).toContain('"0"');
    expect(r.reason).toContain('"-"');
  });

  it('refuses "-/-/-" as a rating nothing can be scheduled against', () => {
    const r = refused(parseFrl('-/-/-'));
    expect(r.reason).toContain('no fire resistance requirement on any criterion');
    expect(r.whatToDo).toContain('smoke door');
  });

  it('refuses an empty element rather than treating it as absent', () => {
    const r = refused(parseFrl('/60/30'));
    expect(r.reason).toContain('is empty');
  });

  it('refuses a negative period', () => {
    expect(parseFrl('-/-60/30').ok).toBe(false);
  });
});

describe('parseFrl — readings that parse but deserve a second look', () => {
  it('drops confidence and notes a grading period the code does not work in', () => {
    const r = parsed(parseFrl('-/45/30'));
    expect(r.confidence).toBe('medium');
    expect(r.notes.join(' ')).toContain('45 minutes of integrity');
    expect(r.notes.join(' ')).toContain('Confirm the reading against the tag');
  });

  it('flags a structural adequacy figure on what should be a door leaf', () => {
    // A leaf carries no load. A figure in the first position is usually the
    // wall's FRL copied into the door's row.
    const r = parsed(parseFrl('60/60/30'));
    expect(r.notes.join(' ')).toContain('carries no load');
  });

  it('flags structural adequacy shorter than integrity as physically odd', () => {
    const r = parsed(parseFrl('30/60/30'));
    expect(r.notes.join(' ')).toContain('cannot still be holding flame back');
  });
});

describe('compareFrl — the tag against the schedule', () => {
  it('reports agreement when the two say the same thing', () => {
    const a = compareFrl('-/60/30', 'FRL -/60/30');
    expect(a.result).toBe('match');
    expect(a.statement).toContain('-/60/30');
  });

  it('treats a disagreement as a building problem, not a records problem', () => {
    const a = compareFrl('-/60/30', '-/120/30');
    expect(a.result).toBe('differs');
    expect(a.statement).toContain('the door has been changed');
    expect(a.statement).toContain('building non-compliance');
  });

  it('refuses to report agreement either way when one side will not parse', () => {
    // "60/30" against "-/60/30" is the trap: they are almost certainly the same
    // door, and saying so would be asserting the shorthand this module refuses.
    const a = compareFrl('60/30', '-/60/30');
    expect(a.result).toBe('unknown');
    expect(a.statement).toContain('No agreement or disagreement should be reported');
  });
});

// ---------------------------------------------------------------------------
// Door types
// ---------------------------------------------------------------------------

describe('door types — what each one fails on', () => {
  it('gives a fire door an FRL and a tag and a smoke door neither', () => {
    expect(DOOR_TYPES.fire.hasFrl).toBe(true);
    expect(DOOR_TYPES.fire.hasTag).toBe(true);
    expect(DOOR_TYPES.smoke.hasFrl).toBe(false);
    expect(DOOR_TYPES.smoke.hasTag).toBe(false);
  });

  it('makes smoke seals part of what a smoke door is and not of what a fire door is', () => {
    expect(DOOR_TYPES.smoke.needsSmokeSeals).toBe(true);
    expect(DOOR_TYPES.fire.needsSmokeSeals).toBe(false);
    expect(DOOR_TYPES['fire-and-smoke'].needsSmokeSeals).toBe(true);
    expect(DOOR_TYPES['fire-and-smoke'].hasFrl).toBe(true);
  });

  it('says a smoke door fails on seals and closing and a fire door on rating and tag', () => {
    expect(DOOR_TYPES.smoke.failsOn.join(' ')).toMatch(/Seals/);
    expect(DOOR_TYPES.smoke.failsOn.join(' ')).toMatch(/closed position/);
    expect(DOOR_TYPES.fire.failsOn.join(' ')).toMatch(/Rating/);
    expect(DOOR_TYPES.fire.failsOn.join(' ')).toMatch(/no tag/);
  });
});

describe('latchingApplies — the check this whole module argues about', () => {
  it('makes a side-hung fire door latch, and makes not latching a failure', () => {
    const l = latchingApplies('fire', 'side-hung');
    expect(l.applies).toBe(true);
    expect(l.isFailure).toBe(true);
    expect(l.reason).toContain('certified latched');
  });

  it('does not ask a double-acting leaf to latch, because it has nothing to latch into', () => {
    // Failing a double-acting smoke door for not latching raises a defect
    // against a door doing exactly what it was built to do.
    const l = latchingApplies('smoke', 'double-acting');
    expect(l.applies).toBe(false);
    expect(l.isFailure).toBe(false);
    expect(l.reason).toContain('returns to the closed position');
  });

  it('does not ask a sliding doorset to latch', () => {
    expect(latchingApplies('fire', 'sliding').applies).toBe(false);
  });

  it('lets a side-hung smoke door fail to latch without calling it a defect', () => {
    const l = latchingApplies('smoke', 'side-hung');
    expect(l.applies).toBe(true);
    expect(l.isFailure).toBe(false);
    expect(l.reason).toContain('also a fire door');
  });

  it('makes a fire and smoke door latch like a fire door', () => {
    expect(latchingApplies('fire-and-smoke', 'side-hung').isFailure).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The tag
// ---------------------------------------------------------------------------

const FULL_TAG: TagParticulars = {
  componentStandard: 'AS/NZS 1905.1',
  frl: '-/60/30',
  manufacturer: 'Example Doors Pty Ltd',
  applicant: 'Example Applicant Pty Ltd',
  certifier: 'Example Certifier Pty Ltd',
  tagNumber: 'G 123',
  yearOfManufacture: '2005',
};

describe('the tag — what it has to establish', () => {
  it("carries the Queensland regulator's seven particulars and says what each proves", () => {
    expect(TAG_PARTICULARS.map((p) => p.key)).toEqual([
      'componentStandard', 'frl', 'manufacturer', 'applicant', 'certifier', 'tagNumber', 'yearOfManufacture',
    ]);
    for (const p of TAG_PARTICULARS) expect(p.establishes.length).toBeGreaterThan(30);
  });

  it('does not credit AS 1905.1 with the door tag number, which is on the Queensland list alone', () => {
    // Clause 6.1.4.2 names six particulars for the leaf tag and a tag number is
    // not one of them. Citing the standard for it puts a figure in a client
    // document behind a source that does not say it.
    const tagNumber = TAG_PARTICULARS.find((p) => p.key === 'tagNumber')!;
    expect(tagNumber.sourceIds).toEqual(['qfd-fire-doors']);
    expect(tagNumber.establishes).toContain('6.1.4.2');
    for (const key of ['componentStandard', 'frl', 'manufacturer', 'applicant', 'certifier', 'yearOfManufacture']) {
      expect(TAG_PARTICULARS.find((p) => p.key === key)!.sourceIds).toContain('as1905-1');
    }
  });

  it('does not claim in a report that the standard requires all seven particulars', () => {
    const a = assessTag({
      leaf: { state: 'present', particulars: FULL_TAG },
      frame: { state: 'present', particulars: { frl: '-/60/30' } },
      buildingApprovedOn: '1/6/2005',
    });
    expect(a.identified).toBe(true);
    expect(a.statement).not.toContain('every particular AS/NZS 1905.1 requires');
    expect(a.statement).toContain('information sheet lists');
  });

  it('explains the manufacturer field by the recall it exists to make possible', () => {
    const manufacturer = TAG_PARTICULARS.find((p) => p.key === 'manufacturer')!;
    expect(manufacturer.establishes).toContain('recall');
  });

  it('ties the year of manufacture to the pre-1990 asbestos window', () => {
    const year = TAG_PARTICULARS.find((p) => p.key === 'yearOfManufacture')!;
    expect(year.establishes).toContain('asbestos');
  });
});

describe('tagRequirement — the date Queensland publishes two ways', () => {
  it('requires a tag for a building approved after the current commencement date', () => {
    const r = tagRequirement({ buildingApprovedOn: '1/7/1990' });
    expect(r.required).toBe(true);
    expect(r.confidence).toBe('high');
    expect(r.reason).toContain('1/4/1976');
  });

  it('does not require a tag for a building approved well before either date', () => {
    const r = tagRequirement({ buildingApprovedOn: '1/1/1970' });
    expect(r.required).toBe(false);
    expect(r.whatToDo).toContain('not the same as being identified');
  });

  it('refuses to choose between two Queensland publications for a 1975 approval', () => {
    // The current QFD information sheet says 1 April 1976; the superseded 2012
    // QFRS FAQ says 15 May 1975. Both are Crown material. Picking one would be
    // inventing a legal position for a building in that window.
    const r = tagRequirement({ buildingApprovedOn: '1/9/1975' });
    expect(r.required).toBeUndefined();
    expect(r.confidence).toBe('low');
    expect(r.reason).toContain('between the two commencement dates');
    expect(r.reason).toContain(formatAuDate(TAG_REQUIRED_FROM));
    expect(r.reason).toContain(formatAuDate(TAG_REQUIRED_FROM_SUPERSEDED));
    expect(r.whatToDo).toContain('building certifier');
  });

  it('requires a tag on a leaf replaced after commencement whatever the age of the building', () => {
    const r = tagRequirement({ buildingApprovedOn: '1/1/1960', doorReplacedOn: '3/3/2019' });
    expect(r.required).toBe(true);
    expect(r.reason).toContain('replaced');
  });

  it('refuses on a leaf replaced inside the disputed window instead of answering off the building', () => {
    // Both Queensland publications say a leaf replaced after their own date
    // needs tags. Reading the replacement question off a 1960 approval hands
    // back a confident "not required" for a door hung in the one window this
    // module exists to stop at.
    const r = tagRequirement({ buildingApprovedOn: '1/1/1960', doorReplacedOn: '1/9/1975' });
    expect(r.required).toBeUndefined();
    expect(r.confidence).toBe('low');
    expect(r.reason).toContain('replaced on 1/9/1975');
    expect(r.reason).toContain('between the two commencement dates');
  });

  it('still answers off the building for a leaf replaced before either date', () => {
    expect(tagRequirement({ buildingApprovedOn: '1/7/1990', doorReplacedOn: '1/1/1970' }).required).toBe(true);
    expect(tagRequirement({ buildingApprovedOn: '1/1/1960', doorReplacedOn: '1/1/1970' }).required).toBe(false);
  });

  it('refuses rather than assuming a modern building when the approval date is missing', () => {
    const r = tagRequirement({});
    expect(r.required).toBeUndefined();
    expect(r.reason).toContain('not recorded');
    expect(r.whatToDo).toContain('certificate of classification');
  });

  it('rejects a month-first date rather than reading 4/11/1976 as April', () => {
    expect(parseAuDate('13/4/1976')).toEqual({ y: 1976, m: 4, d: 13 });
    expect(parseAuDate('4/13/1976')).toBeUndefined();
    expect(parseAuDate('31/2/1976')).toBeUndefined();
    expect(parseAuDate('1976-04-01')).toEqual({ y: 1976, m: 4, d: 1 });
    expect(formatAuDate('1976-04-01')).toBe('1/4/1976');
  });

  it('refuses a date it cannot read instead of falling back to today', () => {
    const r = tagRequirement({ buildingApprovedOn: 'about 1980' });
    expect(r.required).toBeUndefined();
    expect(r.reason).toContain('not a date this app will read');
  });
});

describe('assessTag — identification, never a pass or a failure of the door', () => {
  it('identifies a doorset with complete matching tags that agree with the schedule', () => {
    const a = assessTag({
      leaf: { state: 'present', particulars: FULL_TAG },
      frame: { state: 'present', particulars: { frl: '-/60/30' } },
      scheduleFrl: '-/60/30',
      buildingApprovedOn: '1/6/2005',
    });
    expect(a.identified).toBe(true);
    expect(a.findings).toEqual([]);
    expect(a.defectCode).toBeUndefined();
    expect(a.statement).toContain('Identified');
    expect(a.statement).toContain('-/60/30');
  });

  it('treats a missing tag as an identification finding and not as a failed door', () => {
    // This is the distinction the module exists for. The defect raised is the
    // records code, never the "did not self-close and latch" code.
    const a = assessTag({ leaf: { state: 'missing' }, buildingApprovedOn: '1/6/2005' });
    expect(a.identified).toBe(false);
    expect(a.findings).toEqual(['tag-missing']);
    expect(a.defectCode).toBe(TAG_DEFECT_CODE);
    expect(a.defectCode).not.toBe('DOR-FD-001');
    expect(a.statement).toContain('cannot be shown to be the door the schedule describes');
    expect(a.missingParticulars).toHaveLength(TAG_PARTICULARS.length);
  });

  it('raises no defect for a missing tag on a building that never needed one, and still refuses to pass it', () => {
    const a = assessTag({ leaf: { state: 'missing' }, buildingApprovedOn: '1/1/1970' });
    expect(a.identified).toBe(false);
    expect(a.defectCode).toBeUndefined();
    expect(a.statement).toContain('not itself a');
    expect(a.statement).toContain('unverified');
  });

  it('says the tag requirement is unresolved rather than inventing one', () => {
    const a = assessTag({ leaf: { state: 'missing' }, buildingApprovedOn: '1/9/1975' });
    expect(a.defectCode).toBeUndefined();
    expect(a.statement).toContain('unresolved');
  });

  it('puts an illegible tag in the same position as no tag, and warns about the core', () => {
    const a = assessTag({ leaf: { state: 'illegible' }, buildingApprovedOn: '1/6/2005' });
    expect(a.identified).toBe(false);
    expect(a.findings).toEqual(['tag-illegible']);
    expect(a.statement).toContain('establishes nothing');
    expect(a.notes.join(' ')).toContain('asbestos');
  });

  it('does not call a doorset identified on a leaf tag alone', () => {
    // A leaf tag with no frame tag is the signature of a leaf swapped into an
    // older frame, so the pair is no longer self-evidencing.
    const a = assessTag({
      leaf: { state: 'present', particulars: FULL_TAG },
      buildingApprovedOn: '1/6/2005',
    });
    expect(a.identified).toBe(false);
    expect(a.findings).toContain('frame-tag-missing');
    expect(a.notes.join(' ')).toContain('swapped into an older frame');
  });

  it('lists exactly the particulars the tag is missing', () => {
    const a = assessTag({
      leaf: { state: 'present', particulars: { ...FULL_TAG, certifier: '', tagNumber: undefined } },
      frame: { state: 'present', particulars: { frl: '-/60/30' } },
      buildingApprovedOn: '1/6/2005',
    });
    expect(a.identified).toBe(false);
    expect(a.missingParticulars.map((p) => p.key)).toEqual(['certifier', 'tagNumber']);
    expect(a.findings).toContain('tag-incomplete');
  });

  it('reports a tag that disagrees with the schedule as its own finding', () => {
    const a = assessTag({
      leaf: { state: 'present', particulars: { ...FULL_TAG, frl: '-/120/30' } },
      frame: { state: 'present', particulars: { frl: '-/120/30' } },
      scheduleFrl: '-/60/30',
      buildingApprovedOn: '1/6/2005',
    });
    expect(a.findings).toContain('frl-mismatch');
    expect(a.identified).toBe(false);
    expect(a.statement).toContain('-/120/30');
  });

  it('reports leaf and frame tags that contradict each other', () => {
    const a = assessTag({
      leaf: { state: 'present', particulars: FULL_TAG },
      frame: { state: 'present', particulars: { frl: '-/120/30' } },
      scheduleFrl: '-/60/30',
      buildingApprovedOn: '1/6/2005',
    });
    expect(a.findings).toContain('tags-do-not-match');
    expect(a.notes.join(' ')).toContain('a door that is no longer here');
  });
});

// ---------------------------------------------------------------------------
// Clearance gaps
// ---------------------------------------------------------------------------

const gapChecked = (r: ReturnType<typeof checkGap>): GapCheck => {
  if (!r.known) throw new Error(`expected a check, got a refusal: ${r.reason}`);
  return r;
};

describe('clearance gaps — every sourced limit carries its clause', () => {
  it('cites a clause and a confidence on every limit it holds', () => {
    for (const limit of GAP_LIMITS) {
      expect(limit.clause).toMatch(/AS 1905\.1/);
      expect(limit.sourceIds).toContain('as1905-1');
      expect(['high', 'medium', 'low']).toContain(limit.confidence);
      expect(limit.minMm !== undefined || limit.maxMm !== undefined).toBe(true);
    }
  });

  it('passes a side-hung leaf in a rebated frame on the mean of its readings', () => {
    const c = gapChecked(checkGap({
      position: 'stile',
      readingsMm: [2, 3, 2.5],
      doorType: 'fire',
      leafAction: 'side-hung',
      frame: 'rebated',
    }));
    expect(c.within).toBe(true);
    expect(c.valueMm).toBe(2.5);
    expect(c.statement).toContain('Clause 5.5.3');
    expect(c.defectCode).toBeUndefined();
    expect(c.notes.join(' ')).toContain('AS 1905.1:2015');
  });

  it('fails on the mean rather than on the worst single reading', () => {
    // A limit written against a mean is not a limit against any one point, and
    // failing a door on a single 4 mm reading is a defect raised on a door that
    // complies.
    const ok = gapChecked(checkGap({
      position: 'stile', readingsMm: [2, 4, 2], doorType: 'fire', leafAction: 'side-hung', frame: 'rebated',
    }));
    expect(ok.within).toBe(true);
    expect(ok.worstMm).toBe(4);

    const bad = gapChecked(checkGap({
      position: 'stile', readingsMm: [4, 5, 4], doorType: 'fire', leafAction: 'side-hung', frame: 'rebated',
    }));
    expect(bad.within).toBe(false);
    expect(bad.defectCode).toBe('DOR-FD-003');
    expect(bad.statement).toContain('before the core has been tested');
  });

  it('compares the true mean, not the mean rounded to a tenth of a millimetre', () => {
    // 3.1, 2.9 and 3.05 average 3.017 mm. Rounding that to 3.0 before the
    // comparison passes a door that is over the limit, and the printed figure
    // then reads as evidence that it complied.
    const c = gapChecked(checkGap({
      position: 'stile', readingsMm: [3.1, 2.9, 3.05], doorType: 'fire', leafAction: 'side-hung', frame: 'rebated',
    }));
    expect(c.within).toBe(false);
    expect(c.valueMm).toBe(3);
    expect(c.defectCode).toBe('DOR-FD-003');
  });

  it('does not round a single reading down under a maximum it is actually over', () => {
    const c = gapChecked(checkGap({
      position: 'floor', readingsMm: [10.04], doorType: 'fire', leafAction: 'side-hung', floorCovering: 'none',
    }));
    expect(c.within).toBe(false);
  });

  it('says what the reported figure is rather than leaving a screen to infer it', () => {
    // On the floor the limit has two ends, and the figure reported is whichever
    // end is in question. A screen working the heading out from the basis
    // prints the smallest reading of a passing door as its "worst point".
    const passing = gapChecked(checkGap({
      position: 'floor', readingsMm: [6, 7], doorType: 'fire', leafAction: 'side-hung', floorCovering: 'combustible',
    }));
    expect(passing.valueMm).toBe(6);
    expect(passing.valueLabel).toBe('Smallest gap over the covering');
    expect(passing.worstMm).toBe(7);

    const wide = gapChecked(checkGap({
      position: 'floor', readingsMm: [6, 12], doorType: 'fire', leafAction: 'side-hung', floorCovering: 'combustible',
    }));
    expect(wide.valueMm).toBe(12);
    expect(wide.valueLabel).toBe('Largest gap over the covering');

    expect(gapChecked(checkGap({
      position: 'stile', readingsMm: [2, 3], doorType: 'fire', leafAction: 'side-hung', frame: 'rebated',
    })).valueLabel).toBe('Mean clearance');
    expect(gapChecked(checkGap({
      position: 'sliding-overlap', readingsMm: [80, 90], doorType: 'fire', leafAction: 'sliding',
    })).valueLabel).toBe('Least overlap');
  });

  it('refuses to average a single reading into a mean', () => {
    const r = checkGap({
      position: 'head', readingsMm: [2], doorType: 'fire', leafAction: 'side-hung', frame: 'rebated',
    });
    expect(r.known).toBe(false);
    if (!r.known) {
      expect(r.reason).toContain('cannot establish a mean');
      expect(r.whatToDo).toContain('750 mm');
    }
  });

  it('notes when fewer readings were taken than good practice wants', () => {
    const c = gapChecked(checkGap({
      position: 'stile', readingsMm: [2, 2], doorType: 'fire', leafAction: 'side-hung', frame: 'rebated',
    }));
    expect(c.notes.join(' ')).toContain('at least 3');
  });

  it('refuses the 3 mm figure where the frame is not rebated or nobody looked', () => {
    for (const frame of ['not-rebated', 'unknown'] as const) {
      const r = checkGap({
        position: 'head', readingsMm: [2, 2], doorType: 'fire', leafAction: 'side-hung', frame,
      });
      expect(r.known).toBe(false);
      if (!r.known) expect(r.reason).toContain('rebated');
    }
    const r = checkGap({ position: 'head', readingsMm: [2, 2], doorType: 'fire', leafAction: 'side-hung' });
    expect(r.known).toBe(false);
  });
});

describe('clearance gaps — the floor, where the answer depends on what is down there', () => {
  it('refuses to pick a floor limit when nobody recorded what is under the leaf', () => {
    // Three different limits apply depending on the covering. Guessing picks
    // one of them and reports it as fact.
    const r = checkGap({ position: 'floor', readingsMm: [8], doorType: 'fire', leafAction: 'side-hung' });
    expect(r.known).toBe(false);
    if (!r.known) {
      expect(r.reason).toContain('three different answers');
      expect(r.whatToDo).toContain('carpet not yet laid');
    }
  });

  it('holds a leaf over carpet to the 3 mm to 10 mm range', () => {
    const c = gapChecked(checkGap({
      position: 'floor', readingsMm: [6, 7], doorType: 'fire', leafAction: 'side-hung', floorCovering: 'combustible',
    }));
    expect(c.within).toBe(true);
    expect(c.limit.clause).toContain('5.5.2(a)');
  });

  it('fails a gap that is too small, not only one that is too large', () => {
    // A leaf binding on the carpet will not close under its own closer. That is
    // a closing failure wearing a tight fit as a disguise.
    const c = gapChecked(checkGap({
      position: 'floor', readingsMm: [1, 2], doorType: 'fire', leafAction: 'side-hung', floorCovering: 'combustible',
    }));
    expect(c.within).toBe(false);
    expect(c.statement).toContain('binds');
  });

  it('holds a leaf over a bare sill to the sill maximum', () => {
    const c = gapChecked(checkGap({
      position: 'floor',
      readingsMm: [FLOOR_MAX_OVER_NON_COMBUSTIBLE_SILL_MM],
      doorType: 'fire',
      leafAction: 'side-hung',
      floorCovering: 'none',
    }));
    expect(c.within).toBe(true);
    expect(c.limit.clause).toContain('5.5.2(b)(i)');
    expect(gapChecked(checkGap({
      position: 'floor', readingsMm: [11], doorType: 'fire', leafAction: 'side-hung', floorCovering: 'none',
    })).within).toBe(false);
  });

  it('treats the 25 mm carpet concession as a certification-day allowance to be closed out', () => {
    // The standard's own commentary is explicit that the larger figure exists
    // for carpet in the process of being laid, not for a finished door — and
    // that it is checked at the first maintenance inspection, which is this one.
    const c = gapChecked(checkGap({
      position: 'floor',
      readingsMm: [FLOOR_MAX_CARPET_PENDING_MM - 1],
      doorType: 'fire',
      leafAction: 'side-hung',
      floorCovering: 'carpet-pending',
    }));
    expect(c.within).toBe(true);
    expect(c.confidence).toBe('medium');
    expect(c.notes.join(' ')).toContain('if the carpet is down');
    expect(c.statement).toContain('not a clearance a finished door may keep');
  });
});

describe('clearance gaps — the ones this module refuses to put a number on', () => {
  it('refuses a meeting stile figure and says where the real one lives', () => {
    const r = checkGap({
      position: 'stile',
      readingsMm: [3, 3, 3],
      doorType: 'fire',
      leafAction: 'side-hung',
      frame: 'rebated',
      meetingStile: true,
    });
    expect(r.known).toBe(false);
    if (!r.known) {
      expect(r.reason).toContain('does not give a leaf-to-leaf figure');
      expect(r.whatToDo).toContain('test evidence');
    }
    expect(UNSOURCED_GAPS['meeting-stile'].why).toContain('carried across to a joint it was not written for');
  });

  it('refuses every clearance on a double-acting doorset, because the limit is the tested specimen', () => {
    for (const position of ['head', 'stile', 'floor'] as const) {
      const r = checkGap({
        position,
        readingsMm: [2, 2, 2],
        doorType: 'fire',
        leafAction: 'double-acting',
        frame: 'rebated',
        floorCovering: 'combustible',
      });
      expect(r.known).toBe(false);
      if (!r.known) expect(r.reason).toContain('Clause 5.5.4');
    }
  });

  it('refuses to put a millimetre figure on a smoke door and sends the technician to the seals', () => {
    // A smoke door is sealed, not gap-limited. A made-up figure would fail
    // doors that are sealing and pass doors that are not.
    const r = checkGap({
      position: 'head', readingsMm: [4, 4], doorType: 'smoke', leafAction: 'side-hung', frame: 'rebated',
    });
    expect(r.known).toBe(false);
    if (!r.known) {
      expect(r.reason).toContain('The seal is the test');
      expect(r.whatToDo).toContain('seal condition');
    }
  });

  it('refuses a measurement that is not a measurement', () => {
    expect(checkGap({ position: 'head', readingsMm: [], doorType: 'fire', leafAction: 'side-hung' }).known).toBe(false);
    expect(checkGap({
      position: 'head', readingsMm: [Number.NaN], doorType: 'fire', leafAction: 'side-hung',
    }).known).toBe(false);
    const negative = checkGap({
      position: 'floor', readingsMm: [-2], doorType: 'fire', leafAction: 'side-hung', floorCovering: 'none',
    });
    expect(negative.known).toBe(false);
    if (!negative.known) expect(negative.whatToDo).toContain('binding on the frame is zero');
  });
});

describe('clearance gaps — sliding doorsets', () => {
  it('applies both the mean and the single-point limit to a face clearance', () => {
    const c = gapChecked(checkGap({
      position: 'sliding-face', readingsMm: [8, 9, 10], doorType: 'fire', leafAction: 'sliding',
    }));
    expect(c.within).toBe(true);

    const spike = gapChecked(checkGap({
      position: 'sliding-face',
      readingsMm: [4, 4, SLIDING_FACE_ANY_POINT_MAX_MM + 1],
      doorType: 'fire',
      leafAction: 'sliding',
    }));
    expect(spike.within).toBe(false);
    expect(spike.statement).toContain('single reading');
  });

  it('reads the overlap as a minimum, where too little is the failure', () => {
    const c = gapChecked(checkGap({
      position: 'sliding-overlap', readingsMm: [80, 90], doorType: 'fire', leafAction: 'sliding',
    }));
    expect(c.within).toBe(true);
    const short = gapChecked(checkGap({
      position: 'sliding-overlap', readingsMm: [80, 60], doorType: 'fire', leafAction: 'sliding',
    }));
    expect(short.within).toBe(false);
    expect(short.statement).toContain('straight past the edge');
  });

  it('refuses a sliding measurement on a side-hung leaf and the reverse', () => {
    expect(checkGap({
      position: 'sliding-overlap', readingsMm: [80], doorType: 'fire', leafAction: 'side-hung',
    }).known).toBe(false);
    expect(checkGap({
      position: 'head', readingsMm: [2, 2], doorType: 'fire', leafAction: 'sliding', frame: 'rebated',
    }).known).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Self-closing and latching
// ---------------------------------------------------------------------------

const closing = (over: Partial<ClosingInput> = {}): ClosingInput => ({
  doorType: 'fire',
  leafAction: 'side-hung',
  releasedFrom: ['fully-open', 'intermediate'],
  closedFully: true,
  latched: true,
  ...over,
});

describe('self-closing and latching', () => {
  it('passes a fire door that closed and latched from both positions', () => {
    const v = assessClosing(closing());
    expect(v.outcome).toBe('closed-and-latched');
    expect(v.passed).toBe(true);
    expect(v.defectCode).toBeUndefined();
  });

  it('fails a fire door that closes but does not latch, and says why that is not an observation', () => {
    // The certified thing is the doorset latched, not the leaf resting shut.
    // This is the one condition that looks perfect from across the corridor.
    const v = assessClosing(closing({ latched: false }));
    expect(v.outcome).toBe('closed-not-latched');
    expect(v.passed).toBe(false);
    expect(v.defectCode).toBe('DOR-FD-001');
    expect(v.statement).toContain('pushes an unlatched leaf off its stop');
    expect(v.notes.join(' ')).toContain('not an observation');
  });

  it('does not fail a side-hung smoke door for the same thing', () => {
    const v = assessClosing(closing({ doorType: 'smoke', latched: false }));
    expect(v.outcome).toBe('closed-not-latched');
    expect(v.passed).toBe(true);
    expect(v.defectCode).toBeUndefined();
    expect(v.statement).toContain('observation rather than a defect');
    expect(v.notes.join(' ')).toContain('change the door type');
  });

  it('withholds the observation verdict on a smoke door when only one release position was tried', () => {
    // The observation path is the only one that used to hand back a pass here.
    // A leaf shut off momentum from wide open has not been shown to close from
    // where somebody actually lets go of it, whatever the latch did.
    const v = assessClosing(closing({ doorType: 'smoke', latched: false, releasedFrom: ['fully-open'] }));
    expect(v.outcome).toBe('closed-not-latched');
    expect(v.passed).toBeUndefined();
    expect(v.reason).toContain('Only one release position');
    expect(v.defectCode).toBeUndefined();
  });

  it('never asks a double-acting leaf to latch', () => {
    const v = assessClosing(closing({ doorType: 'smoke', leafAction: 'double-acting', latched: undefined }));
    expect(v.outcome).toBe('closed-no-latch-required');
    expect(v.passed).toBe(true);
  });

  it('fails a door that does not come fully closed and lists what usually causes it', () => {
    const v = assessClosing(closing({ closedFully: false }));
    expect(v.outcome).toBe('did-not-close');
    expect(v.passed).toBe(false);
    expect(v.defectCode).toBe('DOR-FD-001');
    expect(v.notes.join(' ')).toContain('dropped hinge');
  });

  it('gives no verdict when only the fully open position was tested', () => {
    // A weak closer will shut a door from wide open on momentum and leave it
    // 40 mm short from part open, which is where a door is actually left.
    const v = assessClosing(closing({ releasedFrom: ['fully-open'] }));
    expect(v.outcome).toBe('closed-and-latched');
    expect(v.passed).toBeUndefined();
    expect(v.reason).toContain('Only one release position');
    expect(v.notes.join(' ')).toContain('Clause 5.7');
  });

  it('gives no verdict at all when nothing was released', () => {
    const v = assessClosing(closing({ releasedFrom: [], closedFully: undefined, latched: undefined }));
    expect(v.outcome).toBe('not-tested');
    expect(v.passed).toBeUndefined();
    expect(v.reason).toContain('takes ten seconds');
  });

  it('will not read a missing latch result as a pass', () => {
    const v = assessClosing(closing({ latched: undefined }));
    expect(v.outcome).toBe('closed-not-latched');
    expect(v.passed).toBeUndefined();
    expect(v.reason).toContain('Push the closed leaf');
  });
});

describe('doors that are being held open', () => {
  it('fails a wedged door outright and cites the Queensland penalty', () => {
    const v = assessClosing(closing({ heldOpenBy: 'wedge', closedFully: true, latched: true }));
    expect(v.outcome).toBe('held-open');
    expect(v.passed).toBe(false);
    expect(v.defectCode).toBe('DOR-FD-002');
    expect(v.notes.join(' ')).toContain('illegal');
    expect(v.sourceIds).toContain('fire-services-act');
  });

  it('fails furniture and a hooked-back door the same way', () => {
    expect(assessClosing(closing({ heldOpenBy: 'furniture' })).outcome).toBe('held-open');
    expect(assessClosing(closing({ heldOpenBy: 'tied-or-hooked' })).outcome).toBe('held-open');
  });

  it('separates a door standing open on its own broken hardware from one somebody chocked', () => {
    const v = assessClosing(closing({ heldOpenBy: 'hardware-fault' }));
    expect(v.outcome).toBe('did-not-close');
    expect(v.defectCode).toBe('DOR-FD-001');
    expect(v.defectCode).not.toBe('DOR-FD-002');
  });

  it('passes an approved hold-open device only once it has been shown to release', () => {
    const released = assessClosing(closing({ heldOpenBy: 'approved-device', holdOpenReleasedOnAlarm: true }));
    expect(released.outcome).toBe('closed-and-latched');
    expect(released.passed).toBe(true);

    const failed = assessClosing(closing({ heldOpenBy: 'approved-device', holdOpenReleasedOnAlarm: false }));
    expect(failed.outcome).toBe('held-open');
    expect(failed.statement).toContain('nobody will notice this one');
  });

  it('gives no verdict on an untested hold-open device rather than assuming it works', () => {
    const v = assessClosing(closing({ heldOpenBy: 'approved-device' }));
    expect(v.outcome).toBe('not-tested');
    expect(v.passed).toBeUndefined();
    expect(v.notes.join(' ')).toContain('airstream');
  });
});

// ---------------------------------------------------------------------------
// Signage
// ---------------------------------------------------------------------------

describe('signage', () => {
  it('gives the current wording with its letter height', () => {
    const s = requiredSignWording({ era: 'current', heldOpenByDevice: false });
    expect('known' in s).toBe(false);
    if (!('known' in s)) {
      expect(s.wording).toContain('FIRE SAFETY DOOR');
      expect(s.wording).toContain('DO NOT KEEP OPEN');
      expect(s.letterHeightMm).toBe(SIGN_MIN_LETTER_HEIGHT_MM);
    }
  });

  it('drops "do not keep open" from a door held open by an approved device', () => {
    const s = requiredSignWording({ era: 'current', heldOpenByDevice: true });
    if (!('known' in s)) expect(s.wording).not.toContain('DO NOT KEEP OPEN');
  });

  it('gives a door discharging from a fire-isolated exit its own wording, not the self-closing one', () => {
    // The wording that applies to a discharge door is shorter. Specifying "DO
    // NOT KEEP OPEN" for one is a sign bought against the wrong clause.
    const s = requiredSignWording({
      era: 'current', heldOpenByDevice: false, dischargingFromFireIsolatedExit: true,
    });
    if (!('known' in s)) {
      expect(s.wording).toContain('FIRE SAFETY DOOR');
      expect(s.wording).not.toContain('DO NOT KEEP OPEN');
    } else {
      throw new Error('expected a wording');
    }
  });

  it('refuses to pick a wording when the approval era is unknown', () => {
    // Signage complies with what applied at approval. Failing an old sign
    // against a new wording raises a defect against a compliant building.
    const s = requiredSignWording({ heldOpenByDevice: false });
    expect('known' in s).toBe(true);
    if ('known' in s) {
      expect(s.reason).toContain('when the building was approved');
      expect(s.whatToDo).toContain('not a defect merely for using older words');
    }
  });
});

// ---------------------------------------------------------------------------
// The per-door verdict
// ---------------------------------------------------------------------------

const workingDoor = (over: Partial<DoorInput> = {}): DoorInput => ({
  assetId: 'FD-001',
  location: 'Level 6 — Unit 603',
  doorType: 'fire',
  leafAction: 'side-hung',
  frame: 'rebated',
  scheduleFrl: '-/60/30',
  closing: {
    doorType: 'fire',
    leafAction: 'side-hung',
    releasedFrom: ['fully-open', 'intermediate'],
    closedFully: true,
    latched: true,
  },
  gaps: [
    { position: 'stile', readingsMm: [2, 2.5, 2] },
    { position: 'floor', readingsMm: [6, 7], floorCovering: 'combustible' },
  ],
  tag: {
    leaf: { state: 'present', particulars: FULL_TAG },
    frame: { state: 'present', particulars: { frl: '-/60/30' } },
    buildingApprovedOn: '1/6/2005',
  },
  ...over,
});

describe('assessDoor — one door, one honest answer', () => {
  it('passes a door that worked and can be identified', () => {
    const v = assessDoor(workingDoor());
    expect(v.outcome).toBe('pass');
    expect(v.passed).toBe(true);
    expect(v.identified).toBe(true);
    expect(v.defectCodes).toEqual([]);
    expect(v.failedChecks).toEqual([]);
  });

  it('fails on a check that decides whether the opening is protected', () => {
    const v = assessDoor(workingDoor({
      closing: {
        doorType: 'fire', leafAction: 'side-hung', releasedFrom: ['fully-open', 'intermediate'],
        closedFully: true, latched: false,
      },
    }));
    expect(v.outcome).toBe('fail');
    expect(v.passed).toBe(false);
    expect(v.defectCodes).toContain('DOR-FD-001');
    expect(v.failedChecks.map((c) => c.id)).toEqual(['closing']);
  });

  it('keeps a missing tag a separate outcome from a failed door', () => {
    // The whole point. This door works perfectly. It is not a pass, because
    // nobody can show it is the door the schedule describes; it is not a
    // failure, because it did everything a door has to do.
    const v = assessDoor(workingDoor({
      tag: { leaf: { state: 'missing' }, buildingApprovedOn: '1/6/2005' },
    }));
    expect(v.outcome).toBe('unverifiable');
    expect(v.passed).toBeUndefined();
    expect(v.identified).toBe(false);
    expect(v.failedChecks).toEqual([]);
    expect(v.defectCodes).toEqual([TAG_DEFECT_CODE]);
    expect(v.reason).toContain('separate finding from a failed door');
  });

  it('still fails a door that has no tag AND does not latch, on the latching', () => {
    const v = assessDoor(workingDoor({
      closing: {
        doorType: 'fire', leafAction: 'side-hung', releasedFrom: ['fully-open', 'intermediate'],
        closedFully: false,
      },
      tag: { leaf: { state: 'missing' }, buildingApprovedOn: '1/6/2005' },
    }));
    expect(v.outcome).toBe('fail');
    expect(v.defectCodes).toEqual(expect.arrayContaining(['DOR-FD-001', TAG_DEFECT_CODE]));
  });

  it('will not pass a door whose clearance had no applicable limit', () => {
    // A measurement without a limit is evidence, not a result.
    const v = assessDoor(workingDoor({
      gaps: [{ position: 'stile', readingsMm: [3, 3, 3], meetingStile: true }],
    }));
    expect(v.outcome).toBe('unverifiable');
    expect(v.passed).toBeUndefined();
    expect(v.checksWithoutVerdict.map((c) => c.id)).toContain('gap-stile-meeting');
    expect(v.reason).toContain('A check with no result is not a pass');
  });

  it('gives no result at all for a door nobody reached', () => {
    const v = assessDoor(workingDoor({ notAssessedReason: 'Tenancy locked, no key on the day' }));
    expect(v.outcome).toBe('not-assessed');
    expect(v.passed).toBeUndefined();
    expect(v.checks).toEqual([]);
    expect(v.statement).toContain('Tenancy locked');
    expect(v.reason).toContain('neither a pass nor a defect');
  });

  it('assesses a smoke door on its seals and does not look for a tag', () => {
    const v = assessDoor({
      assetId: 'SD-001',
      doorType: 'smoke',
      leafAction: 'double-acting',
      closing: {
        doorType: 'smoke', leafAction: 'double-acting',
        releasedFrom: ['fully-open', 'intermediate'], closedFully: true,
      },
      smokeSeals: 'intact',
    });
    expect(v.outcome).toBe('pass');
    expect(v.checks.find((c) => c.id === 'tag')!.result).toBe('not-applicable');
    expect(v.checks.find((c) => c.id === 'smoke-seals')!.result).toBe('pass');
  });

  it('fails a smoke door on its seals, and notes that no defect code covers them', () => {
    const v = assessDoor({
      assetId: 'SD-002',
      doorType: 'smoke',
      leafAction: 'side-hung',
      closing: {
        doorType: 'smoke', leafAction: 'side-hung',
        releasedFrom: ['fully-open', 'intermediate'], closedFully: true, latched: true,
      },
      smokeSeals: 'damaged',
    });
    expect(v.outcome).toBe('fail');
    expect(v.failedChecks.map((c) => c.id)).toEqual(['smoke-seals']);
    expect(v.notes.join(' ')).toContain('no code for smoke seals');
    expect(v.defectCodes).not.toContain('DOR-FD-003');
  });

  it('gives no verdict on a smoke door whose seals were never looked at', () => {
    const v = assessDoor({
      assetId: 'SD-003',
      doorType: 'smoke',
      leafAction: 'side-hung',
      closing: {
        doorType: 'smoke', leafAction: 'side-hung',
        releasedFrom: ['fully-open', 'intermediate'], closedFully: true, latched: true,
      },
    });
    expect(v.outcome).toBe('unverifiable');
    expect(v.checksWithoutVerdict.map((c) => c.id)).toEqual(['smoke-seals']);
  });

  it('holds a fire and smoke door to both sets of checks', () => {
    const v = assessDoor(workingDoor({ doorType: 'fire-and-smoke', smokeSeals: 'missing' }));
    expect(v.outcome).toBe('fail');
    expect(v.failedChecks.map((c) => c.id)).toEqual(['smoke-seals']);
    expect(v.checks.find((c) => c.id === 'tag')!.result).toBe('pass');
  });

  it('reports a tag that disagrees with the schedule as its own failing check', () => {
    const v = assessDoor(workingDoor({
      scheduleFrl: '-/120/30',
      tag: {
        leaf: { state: 'present', particulars: FULL_TAG },
        frame: { state: 'present', particulars: { frl: '-/60/30' } },
        buildingApprovedOn: '1/6/2005',
      },
    }));
    expect(v.outcome).toBe('fail');
    expect(v.failedChecks.map((c) => c.id)).toContain('frl-agreement');
    expect(v.failedChecks.find((c) => c.id === 'frl-agreement')!.meaning)
      .toContain('protected to less than its approval');
  });

  it('never fails a door with nothing anyone can raise against it', () => {
    // A tag that disagrees with the register on a building that predates the
    // tagging requirement used to come back as a failure carrying no defect
    // code and no note — a critical finding with nowhere to go.
    const v = assessDoor(workingDoor({
      scheduleFrl: '-/120/30',
      tag: {
        leaf: { state: 'present', particulars: FULL_TAG },
        frame: { state: 'present', particulars: { frl: '-/60/30' } },
        buildingApprovedOn: '1/1/1970',
      },
    }));
    expect(v.outcome).toBe('fail');
    expect(v.defectCodes).toEqual([]);
    expect(v.notes.join(' ')).toContain('no code for a tag that disagrees with the register');
    expect(v.notes.join(' ')).toContain('raise it as its own item');
  });

  it('does not treat an untested door as a working one', () => {
    const v = assessDoor(workingDoor({ closing: undefined }));
    expect(v.outcome).toBe('unverifiable');
    expect(v.checks.find((c) => c.id === 'closing')!.result).toBe('no-verdict');
  });
});

// ---------------------------------------------------------------------------
// The site rollup
// ---------------------------------------------------------------------------

describe('summariseDoors — what may honestly be said about a site', () => {
  const pass = (id: string) => assessDoor(workingDoor({ assetId: id }));
  const failing = (id: string) => assessDoor(workingDoor({
    assetId: id,
    closing: {
      doorType: 'fire', leafAction: 'side-hung', releasedFrom: ['fully-open', 'intermediate'],
      closedFully: true, latched: false,
    },
  }));
  const untagged = (id: string) => assessDoor(workingDoor({
    assetId: id, tag: { leaf: { state: 'missing' }, buildingApprovedOn: '1/6/2005' },
  }));
  const missed = (id: string) => assessDoor(workingDoor({ assetId: id, notAssessedReason: 'No access' }));

  it('counts doors, types, passes, failures and unverified separately', () => {
    const s = summariseDoors([pass('a'), pass('b'), failing('c'), untagged('d'), missed('e')]);
    expect(s.total).toBe(5);
    expect(s.assessed).toBe(4);
    expect(s.notAssessed).toBe(1);
    expect(s.passed).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.unverifiable).toBe(1);
    expect(s.byType.fire).toBe(5);
    expect(s.passRatePercent).toBe(50);
    expect(s.coverageRatePercent).toBe(40);
  });

  it('counts how many doorsets are actually identified, and excludes smoke doors from the count', () => {
    const smoke = assessDoor({
      assetId: 's1',
      doorType: 'smoke',
      leafAction: 'double-acting',
      closing: {
        doorType: 'smoke', leafAction: 'double-acting',
        releasedFrom: ['fully-open', 'intermediate'], closedFully: true,
      },
      smokeSeals: 'intact',
    });
    const s = summariseDoors([pass('a'), untagged('b'), smoke]);
    expect(s.taggableDoors).toBe(2);
    expect(s.tagged).toBe(1);
    expect(s.untagged).toBe(1);
    expect(s.byType.smoke).toBe(1);
  });

  it('says what the failures were, most common first', () => {
    const s = summariseDoors([failing('a'), failing('b'), untagged('c')]);
    expect(s.failuresByCheck[0]).toMatchObject({ checkId: 'closing', count: 2, defectCode: 'DOR-FD-001' });
    expect(s.defectCounts).toEqual(expect.arrayContaining([
      { code: 'DOR-FD-001', count: 2 },
      { code: TAG_DEFECT_CODE, count: 1 },
    ]));
  });

  it('calls a site not compliant on a single failure', () => {
    const s = summariseDoors([pass('a'), pass('b'), failing('c')]);
    expect(s.compliant).toBe(false);
    expect(s.compliantStatement).toContain('1 of 3');
  });

  it('refuses to call a site compliant when any door went unassessed', () => {
    // Twenty missed doors out of a thousand is a 2 percent gap and twenty
    // unprotected openings, and "compliant" would be hiding exactly that.
    const s = summariseDoors([pass('a'), pass('b'), missed('c')]);
    expect(s.compliant).toBeUndefined();
    expect(s.compliantStatement).toContain('an unassessed door is not a compliant one');
    expect(s.caveats.join(' ')).toContain('1 of 3 doors were not assessed');
  });

  it('does not count a door nobody reached twice, once as unassessed and once as untagged', () => {
    const s = summariseDoors([pass('a'), missed('b')]);
    expect(s.untagged).toBe(1);
    expect(s.caveats.join(' ')).toContain('not reached at all');
    expect(s.caveats.join(' ')).toContain('not a separate shortfall');

    // And where every untagged doorset really was inspected, no such note.
    const inspected = summariseDoors([pass('a'), untagged('b')]);
    expect(inspected.caveats.join(' ')).not.toContain('not reached at all');
  });

  it('refuses to call a site compliant when a door worked but could not be identified', () => {
    const s = summariseDoors([pass('a'), untagged('b')]);
    expect(s.compliant).toBeUndefined();
    expect(s.compliantStatement).toContain('separate finding from a failure');
    expect(s.caveats.join(' ')).toContain('have not been confirmed on site');
  });

  it('only calls a site compliant when everything was assessed, passed and identified', () => {
    const s = summariseDoors([pass('a'), pass('b')]);
    expect(s.compliant).toBe(true);
    expect(s.compliantStatement).toContain('All 2 doors');
    expect(s.passRatePercent).toBe(100);
  });

  it('says nothing about an empty register rather than calling it compliant', () => {
    const s = summariseDoors([]);
    expect(s.compliant).toBeUndefined();
    expect(s.total).toBe(0);
    expect(s.passRatePercent).toBeUndefined();
    expect(s.compliantStatement).toContain('cannot tell which');
  });

  it('always carries its caveats, including the Queensland interval and the standard edition', () => {
    const s = summariseDoors([pass('a')]);
    expect(s.caveats.length).toBeGreaterThan(2);
    expect(s.caveats.join(' ')).toContain('MP 6.1');
    expect(s.caveats.join(' ')).toContain('six-monthly in Class 5, 6, 9a and 9c');
    expect(s.caveats.join(' ')).toContain('AS 1905.1:2015');
    expect(s.sourceIds).toContain('qdc-mp61');
  });
});
