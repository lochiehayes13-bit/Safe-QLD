import { ADDED_BOX_NOTE, form72Html, type Form72DocumentInput } from '@/export/form72';
import { emptyForm72, type Form72 } from '@/domain/form72';
import {
  OFFICIAL_FORM_72, OFFICIAL_FORM_72_UNITS, OFFICIAL_RESULT_BANDS, OFFICIAL_UNBANDED_PARTS,
  type OfficialEntry, type OfficialSection,
} from './fixtures/officialForm72';

/**
 * Parity with the department's published Form 72, checked against the
 * department's own text rather than against a list somebody typed.
 *
 * The owner's requirement is that the app "generates in this exact f72
 * template". A hand-written list of labels is exactly as good as whoever wrote
 * it, so the inventory lives in fixtures/officialForm72.ts with the page and
 * line each string came from, and this suite renders a form and fails if any of
 * it is absent.
 *
 * Two renders, not one. Everything the department preprints has to be on the
 * page whether or not the technician filled it in, so the inventory is asserted
 * against a form with every box filled AND against a form with none of them
 * filled. That is what makes the fixture state-free: no reading's value and no
 * tick's state can satisfy an entry, because the two renders disagree about
 * every one of them.
 */

const NOW = '2026-07-03T00:00:00.000Z';

/** A form with every box the department prints filled in. */
const filled = (): Form72 => ({
  ...emptyForm72({
    id: 'f1', siteId: 's1', siteName: 'Baldwin Living', contractor: 'Safe QLD Pty Ltd', now: NOW,
  }),
  siteAddress: '12 Example Street, Ipswich QLD 4305',
  testDate: '2026-07-03',
  testTime: '09:30',
  maintenanceTest: {
    hydrantAnnual: true, hydrantFiveYear: true,
    sprinklerAnnual: true, sprinklerFiveYear: true,
    combinedAnnual: true, combinedFiveYear: true,
  },
  hydrostatic: {
    result: 'pass', boostPressureKpa: 1700, testPressureKpa: 1700, durationMinutes: 120,
    endPressureKpa: 1700, lossLpm: 0, comments: 'Held for the duration.',
  },
  flowDeviceKinds: ['orifice', 'mechanical', 'electromagnetic'],
  flowDeviceCalibrated: { mechanical: '2026-01-05', electromagnetic: '2026-01-05' },
  devices: [1, 2, 3, 4].map((n) => ({
    slot: `Device/gauge ${n}`, serialNumber: `SQF-00${n}`, dateCalibrated: '2026-01-05',
    calibrationCertificate: `CR-00${n}`, faceSize: '100mm', digitalReader: true,
    incrementsKpa: 50, correctionFactor: '+10 kPa',
  })),
  flowTest: {
    result: 'pass',
    hydrantLocations: ['Front boundary', 'Carpark', 'Level 3 landing', 'Rear lane'],
    requiredLps: 16, requiredKpa: 700, staticPressureKpa: 900, pressureZone: 'Zone 1',
    onSitePumpSet: true, achievedLps: 20, achievedKpa: 750, comment: 'Made its duty.',
    rows: [
      ...[19, 22, 25].map((nozzleMm) => ({
        nozzleMm, devices: 'SQF-001',
        hydrant1Kpa: 600, hydrants12Kpa: 550, hydrants123Kpa: 500, hydrants1234Kpa: 450,
      })),
      ...[5, 10, 15, 20, 30].map((rateLps) => ({
        rateLps, devices: 'SQF-002',
        hydrant1Kpa: 600, hydrants12Kpa: 550, hydrants123Kpa: 500, hydrants1234Kpa: 450,
      })),
    ],
  },
  booster: {
    result: 'pass', hydrantLocations: 'Level 3 landing valve', highestHydrantAboveBoosterM: 12,
    requiredLps: 16, requiredKpa: 700, staticPressureKpa: 900, pumpInletKpa: 200,
    pumpDischargeKpa: 1200, boostPressureKpa: 1100, hydrantResidualKpa: 900, comments: 'Ran clean.',
  },
  sprinklerHydrostatic: { result: 'pass', pressureKpa: 1700, timeHeldMinutes: 120, comments: 'Held.' },
  sprinklerFlow: {
    result: 'pass', systemSpec: '540 L/min at 200 kPa', runningTestGaugeKpa: 800, comments: 'Ran.',
    testPoints: [1, 2].map((n) => ({
      location: `Control valve ${n}`, requiredFlowLpm: 540, resultFlowLpm: 560,
      requiredPressureKpa: 200, resultPressureKpa: 220,
      flowResult: 'pass' as const, pressureResult: 'pass' as const,
    })),
  },
  criticalDefectsIdentified: false,
  repairsRequired: false,
  systemResult: 'pass',
  licenseeName: 'D. McKee',
  licenceNumber: '1310717',
  licenseeReportNumber: 'R-2026-118',
});

/** A form with nothing filled in, which must still print the whole template. */
const blank = (): Form72 => emptyForm72({
  id: 'f2', siteId: 's1', siteName: '', contractor: '', now: NOW,
});

const doc = (form: Form72): Form72DocumentInput => ({
  form, systemLabel: 'Towns Main System', generatedAt: '2026-07-06T02:00:00.000Z',
});

const FILLED = form72Html(doc(filled()));
const BLANK = form72Html(doc(blank()));

const PART_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const;

/**
 * Where the department's own footer starts on our page.
 *
 * Taken from the renderer's own constant rather than typed again here. The
 * first words of that note are not a stable string — somebody will copy-edit
 * it one day — and a sectioning anchor that breaks on a copy edit would fail
 * three hundred of the cases below for a reason none of them name.
 */
const FOOTER_ANCHOR = `class="subnote">${ADDED_BOX_NOTE.slice(0, 24)}`;

/** Where our own attachment page starts, when the form prints one. */
const ATTACHMENT_ANCHOR = '<div class="attachpage">';

/**
 * The page cut into the department's sections.
 *
 * Scoped rather than searched whole, because half the labels on this form are
 * short words — "System", "Pressure", "Yes", "Pass" — and a document-wide
 * substring search passes on every one of them no matter which part printed it.
 * A label has to be found in the part the department prints it in.
 */
function sectionsOf(html: string): Record<OfficialSection, string> {
  const at = (letter: string): number =>
    html.indexOf(`<span class="bandtitle">Part ${letter}—`);

  /*
   * Thrown rather than expected. These run at module load, where a failed
   * expectation reports as a broken suite with no case to name; a thrown
   * message says in one line which anchor moved, which is the only useful
   * thing to say when the sectioning itself is wrong.
   */
  const footAt = html.indexOf(FOOTER_ANCHOR);
  if (footAt < 0) throw new Error(`parity: footer anchor not found: ${FOOTER_ANCHOR}`);

  // Part I ends where our attachment page begins, on a form that prints one.
  // Otherwise a label the department prints in Part I could be satisfied by
  // our own page below it, and the point of scoping is that it cannot.
  const attachAt = html.indexOf(ATTACHMENT_ANCHOR);
  const endOfParts = attachAt > 0 ? attachAt : footAt;

  const out = {} as Record<OfficialSection, string>;
  out.header = html.slice(0, at('A'));
  PART_LETTERS.forEach((letter, i) => {
    const start = at(letter);
    if (start < 0) throw new Error(`parity: no band for Part ${letter}`);
    const next = i + 1 < PART_LETTERS.length ? at(PART_LETTERS[i + 1]!) : endOfParts;
    out[letter] = html.slice(start, next > start ? next : endOfParts);
  });
  out.footer = html.slice(footAt);
  return out;
}

const FILLED_SECTIONS = sectionsOf(FILLED);
const BLANK_SECTIONS = sectionsOf(BLANK);

/**
 * A section's words with its markup taken out.
 *
 * The department's title spans two elements on our page and a Part D
 * requirement reads "16 L/s at 700 kPa" across three, so a raw substring search
 * would report both as missing. Tags come out, the entities the renderer writes
 * come back, and runs of whitespace collapse — which is what a reader comparing
 * the two documents does.
 */
function textOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#10007;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const needleOf = (e: OfficialEntry): string =>
  (e.deviation?.rendersAs ?? e.text).replace(/\s+/g, ' ');

function haystack(e: OfficialEntry, sections: Record<OfficialSection, string>): string {
  const section = sections[e.section];
  return e.match === 'markup' ? section : textOf(section);
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('every string the department prints is on our page', () => {
  it('has a unique id for every entry, so a failure names one line', () => {
    const ids = OFFICIAL_FORM_72.map((e) => e.id)
      .concat(OFFICIAL_FORM_72_UNITS.map((u) => u.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cites a source line for every entry, so the transcription can be checked', () => {
    for (const e of [...OFFICIAL_FORM_72, ...OFFICIAL_FORM_72_UNITS]) {
      expect({ id: e.id, source: /^p[12] L/.test(e.source) }).toEqual({ id: e.id, source: true });
    }
  });

  describe.each(OFFICIAL_FORM_72.map((e) => [e.id, e] as const))('%s', (_id, e) => {
    it('prints on a form with every box filled in', () => {
      const found = haystack(e, FILLED_SECTIONS).includes(needleOf(e));
      expect({ id: e.id, part: e.section, needle: needleOf(e).slice(0, 70), found })
        .toEqual({ id: e.id, part: e.section, needle: needleOf(e).slice(0, 70), found: true });
    });

    it('prints on a form with nothing filled in, because the template is preprinted', () => {
      const found = haystack(e, BLANK_SECTIONS).includes(needleOf(e));
      expect({ id: e.id, part: e.section, needle: needleOf(e).slice(0, 70), found })
        .toEqual({ id: e.id, part: e.section, needle: needleOf(e).slice(0, 70), found: true });
    });
  });
});

/**
 * The units.
 *
 * Asserted against the filled render alone, and deliberately. The department
 * preprints "kPa" beside an empty box; this page attaches the unit to the
 * number, because printing it unconditionally produced "Not recorded kPa" and
 * "N/A kPa" — a unit on a box nobody filled in. So a unit is proved by a
 * reading carrying it, next to the department's own label, in the department's
 * own part.
 */
describe('every unit annotation prints beside the reading it belongs to', () => {
  it.each(OFFICIAL_FORM_72_UNITS.map((u) => [u.id, u] as const))('%s', (_id, u) => {
    const section = FILLED_SECTIONS[u.section];
    /*
     * The window is measured, not guessed, and it is the whole point of this
     * assertion.
     *
     * At 160 characters this test passed on the wrong element: Part E's
     * "Calculated frictional loss" printed its kPa as body text rather than a
     * unit span, and the nearest real unit span — in the next row — sat 156
     * characters away, inside the window. So the one entry whose unit was
     * missing was the one the test reported as present.
     *
     * Across all 31 entries on a filled render the largest legitimate gap is
     * 68 (D.achieved.kPa, which has a second reading between the label and its
     * unit). 100 clears that with room and is nowhere near a neighbouring row.
     */
    const pattern = new RegExp(
      `${escapeRe(u.field)}[\\s\\S]{0,100}?<span class="u">${escapeRe(u.unit)}</span>`,
    );
    const found = pattern.test(section);
    expect({ id: u.id, field: u.field, unit: u.unit, found })
      .toEqual({ id: u.id, field: u.field, unit: u.unit, found: true });
  });
});

describe('the parts the department bands with PASS and FAIL, and the ones it does not', () => {
  /** A part's band: the dark strip, up to the end of its own div. */
  const bandOf = (sections: Record<OfficialSection, string>, letter: string): string => {
    const s = sections[letter as OfficialSection];
    return s.slice(0, s.indexOf('</div>') + 6);
  };

  it.each(Object.keys(OFFICIAL_RESULT_BANDS))('Part %s carries the department’s two boxes unmarked', (letter) => {
    const band = bandOf(FILLED_SECTIONS, letter);
    for (const label of OFFICIAL_RESULT_BANDS[letter]!) {
      expect({ letter, label, found: band.includes(`<span class="rl">${label}</span>`) })
        .toEqual({ letter, label, found: true });
    }
  });

  it('marks every box in those bands that is not the department’s', () => {
    for (const letter of Object.keys(OFFICIAL_RESULT_BANDS)) {
      const band = bandOf(FILLED_SECTIONS, letter);
      const labels = [...band.matchAll(/<span class="rl">(.*?)<\/span>/g)].map((m) => m[1]!);
      for (const label of labels) {
        const departmental = OFFICIAL_RESULT_BANDS[letter]!.includes(label);
        expect({ letter, label, marked: label.includes('<sup>+</sup>') })
          .toEqual({ letter, label, marked: !departmental });
      }
    }
  });

  it.each(OFFICIAL_UNBANDED_PARTS)('Part %s has no departmental result box, so any box there is marked', (letter) => {
    const band = bandOf(FILLED_SECTIONS, letter);
    const labels = [...band.matchAll(/<span class="rl">(.*?)<\/span>/g)].map((m) => m[1]!);
    for (const label of labels) {
      expect({ letter, label, marked: label.includes('<sup>+</sup>') })
        .toEqual({ letter, label, marked: true });
    }
  });
});

describe('the order the department prints the parts in', () => {
  it('prints the nine bands in order, and the footer after all of them', () => {
    const bands = OFFICIAL_FORM_72.filter((e) => e.kind === 'band');
    expect(bands.length).toBe(9);
    let cursor = -1;
    for (const b of bands) {
      const at = FILLED.indexOf(b.text);
      expect({ id: b.id, inOrder: at > cursor }).toEqual({ id: b.id, inOrder: true });
      cursor = at;
    }
    expect(FILLED.indexOf(FOOTER_ANCHOR)).toBeGreaterThan(cursor);
  });
});

describe('what Safe QLD added, and where it is allowed to be', () => {
  it('keeps every deviation from the department’s wording declared and explained', () => {
    const deviations = OFFICIAL_FORM_72.filter((e) => e.deviation);
    // Counted, so a new one cannot be introduced without this number moving and
    // somebody reading the reason.
    expect(deviations.map((e) => e.id)).toEqual(['C.calibrated', 'C.calibratedElectromagnetic']);
    for (const e of deviations) {
      expect(e.deviation!.why.length).toBeGreaterThan(40);
      expect(e.deviation!.rendersAs).not.toBe(e.text);
    }
  });

  it('prints the system descriptor outside the department’s header, not inside it', () => {
    const strip = FILLED.indexOf('<div class="ourstrip">');
    const head = FILLED.indexOf('<div class="head">');
    expect(strip).toBeGreaterThanOrEqual(0);
    expect(strip).toBeLessThan(head);
    // And the department's header carries the title and nothing else.
    expect(textOf(FILLED.slice(head, FILLED.indexOf('<div class="intro">'))))
      .toBe('Form 72—fire hydrant and sprinkler system periodic testing and maintenance');
  });

  it('says so where nobody answered the flow-measuring-device question', () => {
    /*
     * The three labels themselves are already asserted on both renders, by
     * C.orifice, C.mechanical and C.electromagnetic. What is left to prove is
     * the state of them on a form nobody filled in: three empty boxes read as
     * three noes, and the one thing this question must never do is answer
     * itself. So an unanswered question says it is unanswered.
     */
    expect(BLANK_SECTIONS.C).toContain('Not answered');
    expect(FILLED_SECTIONS.C).not.toContain('Not answered');
  });
});

describe('nothing on the page prints blank', () => {
  it.each([['filled', FILLED], ['blank', BLANK]] as const)('%s', (_name, html) => {
    expect(html).not.toMatch(/<td class="v"[^>]*>\s*<\/td>/);
    expect(html).not.toMatch(/<td class="k"[^>]*>\s*<\/td>\s*<td class="v"/);
  });
});
