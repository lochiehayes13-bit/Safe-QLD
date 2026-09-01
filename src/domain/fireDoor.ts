/**
 * Fire and smoke doors — what the door is, and whether it still does it.
 *
 * Safe QLD's register carries more than a thousand smoke doors and several
 * hundred fire-resistant doorsets, and until now the app has carried one
 * six-monthly routine against them and no logic whatsoever. Every judgement
 * about a door has been made in a technician's head in a stairwell and written
 * down as a tick. These are the five field failures that costs, and this module
 * exists to stop each one.
 *
 *  1. **A misread FRL puts the wrong door on the schedule.** "-/60/30" is three
 *     separate grading periods in a fixed order, and the register itself is
 *     inconsistent about it — the same site's export has "-/60/30", "60/30" and
 *     "n/a" in the same column. A two-element string is *not* an FRL. This
 *     module refuses to silently promote "60/30" to "-/60/30": it says what the
 *     likely reading is, marks it unproven, and sends the technician to the tag.
 *  2. **A door that closes but does not latch, recorded as an observation.** On
 *     a fire-resistant doorset it is a failure. Under fire the leaf bows and the
 *     pressure difference across a compartment pushes an unlatched leaf open;
 *     the certified thing is the doorset latched, not the leaf resting shut. On
 *     a double-acting smoke door there is no latch to test at all, and failing
 *     one for it is a defect raised against a door that is doing its job. The
 *     two cases are decided separately here, by door type and by leaf action.
 *  3. **A missing tag written up as a failed door — or as nothing at all.** A
 *     doorset without its tag may be operating perfectly and still cannot be
 *     proved to be the door the schedule says it is. That is its own outcome
 *     here (`unverifiable`), never folded into `fail` and never quietly passed.
 *  4. **A trade number stated as a clearance limit.** "Three mil around and ten
 *     under" is repeated on every site in Queensland and is right for exactly
 *     one case: a side-hung leaf in a rebated frame, with a floor covering
 *     whose type you actually established. For a double-acting doorset, for
 *     meeting stiles on a pair, and for smoke leakage around a smoke door,
 *     this module has no sourced figure and says so instead of guessing.
 *  5. **"The site's fire doors are compliant."** Said off a sample of the doors
 *     someone could get to, that sentence is worthless. A site is only called
 *     compliant here when every door on the register was assessed, every one
 *     passed, and every one could be identified.
 *
 * On sources: nothing here reproduces the text of AS 1905.1. Clause numbers are
 * facts and are cited; the figures are stated in this file's own words with the
 * clause, the URL and a confidence carried in the DATA, so a limit can never
 * reach a report without its provenance. Queensland Government material — the
 * Queensland Fire Department's own information sheet, QDC MP 6.1 — is Crown
 * material published to be used, and is reproduced faithfully where the app
 * needs it.
 *
 * Where two Queensland sources disagree, both are carried and the disagreement
 * is answered with a refusal rather than a coin toss. They do disagree, on the
 * one date that decides whether a door needed a tag at all.
 */

export type Confidence = 'high' | 'medium' | 'low';

export type SourceId =
  | 'qfd-fire-doors'
  | 'qfrs-faq-2012'
  | 'qdc-mp61'
  | 'as1905-1'
  | 'ncc-spec-1'
  | 'ncc-spec-12'
  | 'ncc-d3-signs'
  | 'fire-services-act'
  | 'trade-gap-method';

export interface Source {
  id: SourceId;
  /** What this source is relied on for, in one line. */
  what: string;
  /** The document, and the clause within it. Numbers only, never text. */
  ref: string;
  url: string;
  confidence: Confidence;
  /**
   * Why the confidence is what it is. The regulator's own sheet and a trade
   * installation guide are not the same kind of fact and a report must never
   * treat them alike.
   */
  basis: string;
}

export const SOURCES: Record<SourceId, Source> = {
  'qfd-fire-doors': {
    id: 'qfd-fire-doors',
    what:
      'What a fire doorset is made of, that it must be self-closing and latching, what the identification tag has to '
      + 'carry, which buildings need tags at all, and that chocking a fire door is an offence',
    ref: 'Queensland Fire Department, "Fire Doors (Fire Resistant Door sets)" Information Sheet, Ver 09/2025',
    url: 'https://www.fire.qld.gov.au/sites/default/files/2024-07/BFS-IS-FireDoors.pdf',
    confidence: 'high',
    basis:
      "The Queensland regulator's own current published information sheet, Crown material under CC BY-ND 4.0. This is "
      + 'the source that governs where anything else disagrees with it.',
  },
  'qfrs-faq-2012': {
    id: 'qfrs-faq-2012',
    what:
      'The superseded statement of the same requirements, kept only because it gives a different date for when fire '
      + 'door tags became required',
    ref: 'Queensland Fire and Rescue Service, "Frequently Asked Questions (FAQ) on Fire Doors", Version 1, November 2012',
    url: 'https://www.fire.qld.gov.au/buildingsafety',
    confidence: 'medium',
    basis:
      'Crown material, but superseded by the 2025 information sheet and retained here only to record that the two '
      + 'Queensland publications give different tag commencement dates. Not to be relied on alone.',
  },
  'qdc-mp61': {
    id: 'qdc-mp61',
    what:
      'That fire and smoke doorsets are prescribed passive fire safety installations, and the maintenance frequency: '
      + 'six-monthly in Class 5, 6, 9a and 9c buildings and yearly in all others',
    ref: 'Queensland Development Code MP 6.1, Schedule 1, Tables 1 and 2 (AS 1851:2005 clauses 17.4.3.1, 17.4.3.2, 17.4.4, 17.4.5)',
    url: 'https://www.hpw.qld.gov.au/__data/assets/pdf_file/0017/4832/qdcmp6.1.pdf',
    confidence: 'high',
    basis:
      'Queensland Crown material, read directly. Note that MP 6.1 cites clause numbers from the 2005 edition of '
      + 'AS 1851, not the 2012 edition — a service quoted against AS 1851-2012 section 16 is quoting a different '
      + 'document from the one the Queensland code names.',
  },
  'as1905-1': {
    id: 'as1905-1',
    what:
      'Installation clearances (Clause 5.5), hardware (5.6), the final latching check (5.7), the identification tags '
      + 'and what they carry (6.1), and the record system a maintenance regime is kept against (6.3.3)',
    ref: 'AS 1905.1—2005, Clauses 5.5.2, 5.5.3, 5.5.4, 5.5.5, 5.6, 5.7, 6.1.2, 6.1.3, 6.1.4, 6.3.3',
    url: 'https://store.standards.org.au/product/as-1905-1-2005',
    confidence: 'high',
    basis:
      "Clause numbers and figures read from Safe QLD's own licensed copy and restated here in this app's words; no "
      + 'text, table or figure is reproduced. The edition matters: the 2005 edition is superseded by AS 1905.1:2015, '
      + 'and any figure below should be re-read against the current edition before it is quoted to a client.',
  },
  'ncc-spec-1': {
    id: 'ncc-spec-1',
    what:
      'That a fire-resistance level is three grading periods in minutes — structural adequacy, then integrity, then '
      + 'insulation, in that order — and how they are determined',
    ref: 'NCC 2022 Volume One, Schedule 1 definitions ("fire-resistance level", "structural adequacy", "integrity", "insulation") and Specification 1',
    url: 'https://ncc.abcb.gov.au/editions/ncc-2022/adopted/volume-one/a-governing-requirements/1-fire-resistance-building-elements',
    confidence: 'high',
    basis: "The regulator's own published code, free to read online.",
  },
  'ncc-spec-12': {
    id: 'ncc-spec-12',
    what:
      'That a required fire door complies with AS 1905.1 (S12C2), and what a smoke door has to be and do — solid core '
      + 'or smoke-resisting leaf, smoke seals, normally closed or released by smoke detection, and returning to the '
      + 'closed position after being opened (S12C3, S12C4)',
    ref: 'NCC 2022 Volume One, Specification 12, Clauses S12C2, S12C3, S12C4 (BCA 2019 and earlier: Specification C3.4, Clauses 2 and 3)',
    url: 'https://ncc.abcb.gov.au/editions/ncc-2022/adopted/volume-one/c-fire-resistance/12-fire-doors-smoke-doors-fire-windows-and-shutters',
    confidence: 'high',
    basis: "The regulator's own published specification, with clause numbers.",
  },
  'ncc-d3-signs': {
    id: 'ncc-d3-signs',
    what: 'The wording, letter height and placement of the sign that must appear on a required fire or smoke door',
    ref: 'NCC 2022 Volume One, Part D3 (D3D28 Signs on doors); BCA 2019 and earlier, D2.23',
    url: 'https://ncc.abcb.gov.au/editions/ncc-2022/adopted/volume-one/d-access-and-egress/part-d3-construction-exits',
    confidence: 'medium',
    basis:
      'The two sign wordings were read from BCA D2.23 in the material the owner supplied, one from an early edition '
      + 'and one from a later one, and they differ. The NCC 2022 renumbering to D3D28 was taken from secondary '
      + 'sources rather than the code itself, so the clause number carries less weight than the wording does.',
  },
  'fire-services-act': {
    id: 'fire-services-act',
    what: 'The occupier’s standing obligation to maintain every prescribed fire safety installation',
    ref: 'Fire Services Act 1990 (Qld), section 146M (section 104D in earlier reprints)',
    url: 'https://www.legislation.qld.gov.au/view/html/inforce/current/act-1990-010',
    confidence: 'high',
    basis:
      'Queensland legislation, and the section number is the one the Queensland Fire Department’s current '
      + 'information sheet cites.',
  },
  'trade-gap-method': {
    id: 'trade-gap-method',
    what:
      'How many readings a mean clearance is taken from — at least three down each vertical edge and two across the '
      + 'head, spaced not less than 750 mm apart',
    ref: 'Trade inspection guidance describing AS 1905.1 measurement practice',
    url: 'https://completefiregroup.com.au/as1905-1/',
    confidence: 'low',
    basis:
      'Second-hand trade guidance, not the standard. It is carried because a "mean clearance" taken from one reading '
      + 'is not a mean at all, and something has to say how many readings is enough. Treat the count as a floor for '
      + 'good practice rather than as a requirement, and read Clause 5.5.3 for the requirement itself.',
  },
};

/** Every source behind a result, in the order a report should list them. */
export function citeSources(ids: SourceId[]): Source[] {
  const seen = new Set<SourceId>();
  const out: Source[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(SOURCES[id]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fire resistance level
// ---------------------------------------------------------------------------

/**
 * The three grading periods, in the order they are written.
 *
 * The order is the whole point and it is the thing most often got wrong on a
 * schedule. "-/60/30" does not mean "a 60/30 door"; it means no structural
 * adequacy requirement, sixty minutes of integrity, thirty of insulation. A
 * technician who reads that as "60 minute door" has overstated it by half on
 * the criterion that decides whether the far face of the leaf will set fire to
 * whatever is leaning against it.
 */
export type FrlElementId = 'structural-adequacy' | 'integrity' | 'insulation';

export interface FrlElementSpec {
  id: FrlElementId;
  /** 1, 2 or 3 — which slot in "-/60/30" this is. */
  position: 1 | 2 | 3;
  label: string;
  /** What the criterion is, in this app's words. */
  means: string;
  /** What its failure looks like in a real fire, which is what makes it matter. */
  failureLooksLike: string;
  sourceIds: SourceId[];
}

export const FRL_ELEMENTS: FrlElementSpec[] = [
  {
    id: 'structural-adequacy',
    position: 1,
    label: 'Structural adequacy',
    means: 'How long the element keeps standing up and carrying whatever load it carries.',
    failureLooksLike:
      'The element collapses. A door leaf carries no load, so a fire doorset almost always shows "-" here — a doorset '
      + 'with a figure in the first position is unusual and worth a second look at the tag.',
    sourceIds: ['ncc-spec-1'],
  },
  {
    id: 'integrity',
    position: 2,
    label: 'Integrity',
    means: 'How long the element stops flame and hot gases getting through it.',
    failureLooksLike:
      'Flame or hot gas passes through a gap, a split or a failed seal. This is the criterion a door normally fails '
      + 'first, and it is the number people mean when they say "a 60 minute door".',
    sourceIds: ['ncc-spec-1'],
  },
  {
    id: 'insulation',
    position: 3,
    label: 'Insulation',
    means: 'How long the element stops heat getting through it, measured on the face away from the fire.',
    failureLooksLike:
      'The unexposed face gets hot enough to ignite what is against it, without any flame having come through. On a '
      + 'doorset this is normally the smallest of the three periods, which is why "-/60/30" is a shorter door than it '
      + 'sounds.',
    sourceIds: ['ncc-spec-1'],
  },
];

export const FRL_ELEMENT_BY_ID: Record<FrlElementId, FrlElementSpec> = {
  'structural-adequacy': FRL_ELEMENTS[0]!,
  integrity: FRL_ELEMENTS[1]!,
  insulation: FRL_ELEMENTS[2]!,
};

/** Which criterion sits in a given slot. Answers "which number is the insulation". */
export function frlElementAt(position: 1 | 2 | 3): FrlElementSpec {
  return FRL_ELEMENTS[position - 1]!;
}

/**
 * A parsed fire-resistance level.
 *
 * `undefined` on an element is "-" — no requirement — which is a different
 * statement from zero minutes and must never be stored as zero.
 */
export interface Frl {
  structuralAdequacy?: number;
  integrity?: number;
  insulation?: number;
}

/**
 * The grading periods the code and the test standard actually work in.
 *
 * A figure outside this set is not automatically wrong, but on a door tag it is
 * far more often a misread than a real rating, so it is noted rather than
 * accepted in silence.
 */
export const USUAL_GRADING_PERIODS = [30, 60, 90, 120, 180, 240] as const;

export interface FrlCandidate {
  frl: Frl;
  normalised: string;
  /** Why this reading is plausible, and what would confirm it. */
  reading: string;
}

export interface FrlParsed {
  ok: true;
  input: string;
  frl: Frl;
  /** Always three elements with "-" for absent: "-/60/30". */
  normalised: string;
  notes: string[];
  confidence: Confidence;
  sourceIds: SourceId[];
}

export interface FrlRefusal {
  ok: false;
  input: string;
  reason: string;
  /** What the technician should do to get an answer. */
  whatToDo: string;
  /**
   * Readings that are plausible but not proven. Deliberately separate from a
   * result: a caller has to reach for these on purpose, and cannot get one by
   * forgetting to check `ok`.
   */
  candidates: FrlCandidate[];
  sourceIds: SourceId[];
}

export type FrlResult = FrlParsed | FrlRefusal;

const FRL_SOURCES: SourceId[] = ['ncc-spec-1', 'as1905-1'];

/** "-/60/30" from the parts, with "-" for an element with no requirement. */
export function formatFrl(frl: Frl): string {
  const part = (n?: number) => (n === undefined ? '-' : String(n));
  return `${part(frl.structuralAdequacy)}/${part(frl.integrity)}/${part(frl.insulation)}`;
}

const refuseFrl = (
  input: string,
  reason: string,
  whatToDo: string,
  candidates: FrlCandidate[] = [],
): FrlRefusal => ({ ok: false, input, reason, whatToDo, candidates, sourceIds: FRL_SOURCES });

/** Characters that get typed or OCR'd where a digit belongs. */
const DIGIT_LOOKALIKES: Record<string, string> = { O: '0', o: '0', l: '1', I: '1', S: '5', s: '5', B: '8' };

function parseElement(raw: string): { minutes?: number } | { error: string } {
  const text = raw.trim();
  if (text === '') return { error: 'is empty' };
  if (/^[-‐-―−]$/.test(text)) return { minutes: undefined };
  if (/^\d{1,4}$/.test(text)) {
    const minutes = Number(text);
    if (minutes === 0) {
      return {
        error: 'is "0". An element with no requirement is written "-"; zero minutes of fire resistance is not a grading period',
      };
    }
    return { minutes };
  }
  const looky = [...text].filter((c) => c in DIGIT_LOOKALIKES);
  if (looky.length > 0 && /^[\dOolISsB]+$/.test(text)) {
    const fixed = [...text].map((c) => DIGIT_LOOKALIKES[c] ?? c).join('');
    return { error: `is "${text}" — that is a letter where a digit belongs, and probably reads ${fixed}` };
  }
  return { error: `is "${text}", which is neither a number of minutes nor "-"` };
}

/**
 * Read an FRL off a tag, a schedule or a register cell.
 *
 * Accepts what a technician actually types — a leading "FRL", stray spaces, a
 * backslash instead of a slash, an en dash instead of a hyphen — and refuses
 * everything it cannot prove, with the likely reading attached as a candidate
 * rather than returned as the answer.
 *
 * Two refusals are worth knowing about before they surprise someone:
 *
 *  - **"60/30"** is refused. It is overwhelmingly the register's shorthand for
 *    "-/60/30" and it is written that way all over Safe QLD's own export, but
 *    an FRL has three elements and a two-element string does not say which two.
 *    Reading it as -/60/30 would be right almost every time, and the time it
 *    was wrong the door would go on a schedule understating a structural
 *    requirement. The likely reading comes back in `candidates`.
 *  - **"-/30/60"** is refused as impossible rather than parsed. Insulation is
 *    only assessed while integrity holds, so an insulation period longer than
 *    the integrity period cannot have been achieved on test. The transposed
 *    reading comes back as the candidate, because that is what it almost
 *    certainly is.
 */
export function parseFrl(input: string): FrlResult {
  const original = input ?? '';
  const notes: string[] = [];

  let text = original.trim();
  if (text === '') {
    return refuseFrl(
      original,
      'No fire-resistance level was recorded.',
      'Read the FRL off the tag on the hinge stile of the leaf. If there is no tag, the door cannot be scheduled '
        + 'against an FRL at all — record it as untagged rather than guessing one.',
    );
  }

  // "FRL -/60/30" and "FRL: -/60/30" both come off tags and schedules.
  text = text.replace(/^frl\b\s*:?\s*/i, '').trim();

  const naish = text.toLowerCase().replace(/[.\s]/g, '');
  if (['na', 'n/a', 'nil', 'none', 'notapplicable', 'nofrl', '-', 'unknown'].includes(naish)) {
    return refuseFrl(
      original,
      `The FRL is recorded as "${text}", which is a statement that there is no figure, not a figure.`,
      'A door on the passive register with no FRL is either a smoke door — which has no FRL and should be typed as '
        + 'one — or a fire doorset whose rating nobody has established. Decide which, and tag it accordingly.',
    );
  }

  if (text.includes('\\')) {
    notes.push('Backslashes were read as slashes.');
    text = text.replace(/\\/g, '/');
  }
  // En dash, em dash, figure dash and the true minus sign all get typed for "-".
  if (/[‐-―−]/.test(text)) {
    notes.push('A dash character other than a plain hyphen was read as "-".');
    text = text.replace(/[‐-―−]/g, '-');
  }
  text = text.replace(/\s*\/\s*/g, '/').trim();

  const parts = text.split('/');

  if (parts.length === 2) {
    const shorthand = parseFrl(`-/${text}`);
    const candidates: FrlCandidate[] = shorthand.ok
      ? [{
        frl: shorthand.frl,
        normalised: shorthand.normalised,
        reading:
          'Read as an integrity and insulation pair with no structural adequacy requirement, which is how a door '
          + 'leaf is normally rated and how this register abbreviates it.',
      }]
      : [];
    return refuseFrl(
      original,
      `"${text}" has two elements. A fire-resistance level always has three — structural adequacy, integrity and `
        + 'insulation — so a two-element string does not say which two these are.',
      'Read the full FRL off the door tag and record all three elements. If the register cell is the only source, '
        + 'correct the register rather than reading the missing element in.',
      candidates,
    );
  }

  if (parts.length !== 3) {
    return refuseFrl(
      original,
      `"${text}" has ${parts.length} element${parts.length === 1 ? '' : 's'} separated by slashes. A `
        + 'fire-resistance level has exactly three.',
      parts.length === 1
        ? 'An FRL is written as three grading periods separated by slashes, for example -/60/30.'
        : 'Check whether something has been appended to the FRL — a leaf reference or a door number belongs in its '
          + 'own column, not in the FRL.',
    );
  }

  const elementIds: FrlElementId[] = ['structural-adequacy', 'integrity', 'insulation'];
  const values: (number | undefined)[] = [];
  for (let i = 0; i < 3; i++) {
    const parsed = parseElement(parts[i]!);
    if ('error' in parsed) {
      const spec = FRL_ELEMENT_BY_ID[elementIds[i]!];
      return refuseFrl(
        original,
        `The ${spec.label.toLowerCase()} element — position ${spec.position} of "${text}" — ${parsed.error}.`,
        `Each element is a whole number of minutes, or "-" where there is no requirement. ${spec.label} is `
          + `${spec.means.charAt(0).toLowerCase()}${spec.means.slice(1)}`,
      );
    }
    values.push(parsed.minutes);
  }

  const frl: Frl = {
    structuralAdequacy: values[0],
    integrity: values[1],
    insulation: values[2],
  };

  if (frl.structuralAdequacy === undefined && frl.integrity === undefined && frl.insulation === undefined) {
    return refuseFrl(
      original,
      '"-/-/-" states that there is no fire resistance requirement on any criterion, which is not a rating a fire '
        + 'doorset can be scheduled against.',
      'A door with no FRL at all is not a fire-resistant doorset. Check whether this is a smoke door, a solid core '
        + 'door, or an ordinary door that has found its way onto the passive register.',
    );
  }

  if (frl.integrity !== undefined && frl.insulation !== undefined && frl.insulation > frl.integrity) {
    const transposed: Frl = { ...frl, integrity: frl.insulation, insulation: frl.integrity };
    return refuseFrl(
      original,
      `"${text}" gives ${frl.insulation} minutes of insulation against ${frl.integrity} minutes of integrity. `
        + 'Insulation is only assessed for as long as integrity holds, so an insulation period longer than the '
        + 'integrity period cannot have been achieved on test.',
      'The two figures are almost certainly the right way round on the tag and the wrong way round in the record. '
        + 'Go back to the tag and read the middle element first.',
      [{
        frl: transposed,
        normalised: formatFrl(transposed),
        reading: 'The same two figures transposed, which is a rating a doorset can actually hold.',
      }],
    );
  }

  let confidence: Confidence = 'high';

  const unusual = ([
    ['structural adequacy', frl.structuralAdequacy],
    ['integrity', frl.integrity],
    ['insulation', frl.insulation],
  ] as const)
    .filter(([, v]) => v !== undefined && !(USUAL_GRADING_PERIODS as readonly number[]).includes(v))
    .map(([name, v]) => `${v} minutes of ${name}`);
  if (unusual.length > 0) {
    confidence = 'medium';
    notes.push(
      `${unusual.join(' and ')} ${unusual.length === 1 ? 'is not one of' : 'are not'} the grading periods the code `
      + `normally works in (${USUAL_GRADING_PERIODS.join(', ')}). Confirm the reading against the tag before it goes `
      + 'on a schedule.',
    );
  }

  if (frl.structuralAdequacy !== undefined) {
    notes.push(
      `This FRL carries a structural adequacy requirement of ${frl.structuralAdequacy} minutes. A door leaf carries `
      + 'no load and normally shows "-" in that position, so check the first element is the door’s and not the '
      + 'wall’s.',
    );
  }

  if (
    frl.structuralAdequacy !== undefined
    && frl.integrity !== undefined
    && frl.structuralAdequacy < frl.integrity
  ) {
    notes.push(
      'Structural adequacy is shorter than integrity here, which is unusual — an element that has collapsed cannot '
      + 'still be holding flame back. Worth confirming.',
    );
  }

  return {
    ok: true,
    input: original,
    frl,
    normalised: formatFrl(frl),
    notes,
    confidence,
    sourceIds: FRL_SOURCES,
  };
}

export interface FrlExplanation {
  position: 1 | 2 | 3;
  element: FrlElementId;
  label: string;
  /** Minutes, or undefined where the element is "-". */
  minutes?: number;
  /** The whole line a screen or a report prints for this element. */
  text: string;
}

/** What each position of an FRL is saying, for a screen or a report. */
export function explainFrl(frl: Frl): FrlExplanation[] {
  const minutes: Record<FrlElementId, number | undefined> = {
    'structural-adequacy': frl.structuralAdequacy,
    integrity: frl.integrity,
    insulation: frl.insulation,
  };
  return FRL_ELEMENTS.map((spec) => {
    const m = minutes[spec.id];
    return {
      position: spec.position,
      element: spec.id,
      label: spec.label,
      minutes: m,
      text: m === undefined
        ? `No ${spec.label.toLowerCase()} requirement. ${spec.means}`
        : `${m} minutes of ${spec.label.toLowerCase()}. ${spec.means}`,
    };
  });
}

export type FrlComparison = 'match' | 'differs' | 'unknown';

export interface FrlAgreement {
  result: FrlComparison;
  statement: string;
  /** Present only where both sides parsed. */
  tag?: Frl;
  schedule?: Frl;
}

/**
 * Whether the tag and the schedule are describing the same door.
 *
 * A disagreement here is not a paperwork tidy-up. Either the schedule is wrong
 * about a door in a fire wall, or the door has been replaced with one of a
 * different rating and nobody updated the record — and the second is a
 * building with an opening protected to less than it was approved for.
 */
export function compareFrl(tagFrl: string | undefined, scheduleFrl: string | undefined): FrlAgreement {
  const tag = tagFrl === undefined ? undefined : parseFrl(tagFrl);
  const sched = scheduleFrl === undefined ? undefined : parseFrl(scheduleFrl);

  if (!tag || !tag.ok || !sched || !sched.ok) {
    const missing: string[] = [];
    if (!tag || !tag.ok) missing.push('the tag');
    if (!sched || !sched.ok) missing.push('the schedule');
    return {
      result: 'unknown',
      statement:
        `Cannot compare the tag with the schedule because the FRL on ${missing.join(' and ')} could not be read. `
        + 'No agreement or disagreement should be reported either way.',
    };
  }

  if (tag.normalised === sched.normalised) {
    return {
      result: 'match',
      statement: `Tag and schedule agree: ${tag.normalised}.`,
      tag: tag.frl,
      schedule: sched.frl,
    };
  }

  return {
    result: 'differs',
    statement:
      `The tag reads ${tag.normalised} and the schedule says ${sched.normalised}. Either the register is wrong about `
      + 'this opening or the door has been changed. Resolve it before the door is signed off — a wall protected to '
      + 'less than its approval is a building non-compliance, not a records issue.',
    tag: tag.frl,
    schedule: sched.frl,
  };
}

// ---------------------------------------------------------------------------
// Door types
// ---------------------------------------------------------------------------

export type DoorType = 'fire' | 'smoke' | 'fire-and-smoke';

/** How the leaf moves, which decides what may be asked of it. */
export type LeafAction = 'side-hung' | 'double-acting' | 'sliding';

export interface DoorTypeProfile {
  id: DoorType;
  label: string;
  /** What the door is for, in one sentence. */
  purpose: string;
  /** Whether it carries an FRL at all. */
  hasFrl: boolean;
  /** Whether AS 1905.1 identification tags apply to it. */
  hasTag: boolean;
  /** Whether smoke seals are part of what it is. */
  needsSmokeSeals: boolean;
  /**
   * Whether latching is part of what it is certified as. Undefined where it
   * depends on the leaf action rather than on the door type — see
   * `latchingApplies`.
   */
  mustLatch?: boolean;
  /** What this kind of door fails on, in service, in a technician's words. */
  failsOn: string[];
  sourceIds: SourceId[];
}

/**
 * What separates the three in service.
 *
 * The distinction that matters on site is not what they are made of, it is what
 * you fail them for. A smoke door fails on its seals and on whether it comes
 * back to the closed position; it has no rating to check and no tag to read. A
 * fire door fails on its rating, its clearances and its tag; latching is part
 * of what it was certified as, and it is not optional. A door that is both is
 * held to both, and passes only if it satisfies both.
 */
export const DOOR_TYPES: Record<DoorType, DoorTypeProfile> = {
  fire: {
    id: 'fire',
    label: 'Fire door (fire-resistant doorset)',
    purpose:
      'Protects an opening in a fire-resisting wall so the wall keeps doing its job with a doorway in it. Complies '
      + 'with AS 1905.1 and carries an FRL.',
    hasFrl: true,
    hasTag: true,
    needsSmokeSeals: false,
    failsOn: [
      'Rating: an FRL that cannot be established, or does not match the schedule.',
      'Identification: no tag, an illegible tag, or leaf and frame tags that do not match.',
      'Clearances outside what the standard allows for the leaf action and the floor finish.',
      'Self-closing and latching, from the fully open position and from part open.',
      'Hardware that is not what the doorset was certified with.',
    ],
    sourceIds: ['ncc-spec-12', 'as1905-1', 'qfd-fire-doors'],
  },
  smoke: {
    id: 'smoke',
    label: 'Smoke door',
    purpose:
      'Holds smoke back at an opening — a solid core leaf or one that resists smoke at elevated temperature, with '
      + 'smoke seals, normally closed or released by smoke detection.',
    hasFrl: false,
    hasTag: false,
    needsSmokeSeals: true,
    failsOn: [
      'Seals: missing, torn, painted over, worn away or not making contact.',
      'Closing: it does not return to the closed position after being opened.',
      'Being held open by anything that does not release on smoke detection.',
      'A leaf that is no longer solid core or smoke resisting — a cut-out, a fitted grille, a broken vision panel.',
    ],
    sourceIds: ['ncc-spec-12'],
  },
  'fire-and-smoke': {
    id: 'fire-and-smoke',
    label: 'Fire and smoke door',
    purpose:
      'A fire-resistant doorset that is also a required smoke door. It has to satisfy both, and a report that treats '
      + 'it as only one of them is understating what it was approved as.',
    hasFrl: true,
    hasTag: true,
    needsSmokeSeals: true,
    failsOn: [
      'Everything a fire door fails on.',
      'Everything a smoke door fails on.',
      'Seals fitted to a fire doorset must be part of what it was tested with — an aftermarket seal on a rated leaf '
      + 'is a variation from the tested specimen, not an improvement.',
    ],
    sourceIds: ['ncc-spec-12', 'as1905-1'],
  },
};

/**
 * Whether latching can be asked of this door at all.
 *
 * A double-acting leaf swings both ways and has nothing to latch into; failing
 * one for not latching raises a defect against a door that is doing exactly
 * what it was built to do. A sliding fire doorset closes across the opening and
 * is held by its own closing system rather than a latch. Only a side-hung
 * doorset can be held to the latching check, and where the door is also a fire
 * door it must be.
 */
export function latchingApplies(doorType: DoorType, leafAction: LeafAction): {
  applies: boolean;
  /** True where a failure to latch is a defect rather than an observation. */
  isFailure: boolean;
  reason: string;
  sourceIds: SourceId[];
} {
  if (leafAction === 'double-acting') {
    return {
      applies: false,
      isFailure: false,
      reason:
        'A double-acting leaf swings both ways and has no latch to engage. What is required of it is that it returns '
        + 'to the closed position, and that is the check to record.',
      sourceIds: ['as1905-1', 'ncc-spec-12'],
    };
  }
  if (leafAction === 'sliding') {
    return {
      applies: false,
      isFailure: false,
      reason:
        'A horizontally sliding doorset closes across the opening and is held by its closing system, not by a latch. '
        + 'Check that it runs fully closed and that the overlap onto the jambs and head is there.',
      sourceIds: ['as1905-1'],
    };
  }
  if (doorType === 'smoke') {
    return {
      applies: true,
      isFailure: false,
      reason:
        'A side-hung smoke door has to return to the closed position; latching is not what makes it a smoke door. If '
        + 'a latch is fitted and does not engage, record it as an observation — unless this opening is also a fire '
        + 'door, in which case it is a failure.',
      sourceIds: ['ncc-spec-12'],
    };
  }
  return {
    applies: true,
    isFailure: true,
    reason:
      'A side-hung fire doorset is certified latched, not merely shut. Under fire the leaf distorts and the pressure '
      + 'difference across the compartment pushes an unlatched leaf off its stop, so a door that closes without '
      + 'latching would be an open doorway at the moment it is needed. AS 1905.1 makes latching from the fully open '
      + 'position and from any intermediate position part of the final check and part of what the tag certifies.',
    sourceIds: ['as1905-1'],
  };
}

// ---------------------------------------------------------------------------
// The tag
// ---------------------------------------------------------------------------

export type TagParticularKey =
  | 'componentStandard'
  | 'frl'
  | 'manufacturer'
  | 'applicant'
  | 'certifier'
  | 'tagNumber'
  | 'yearOfManufacture';

export interface TagParticularSpec {
  key: TagParticularKey;
  label: string;
  /** What this particular establishes. Without it, what cannot be proved. */
  establishes: string;
  sourceIds: SourceId[];
}

/**
 * What the tag has to establish.
 *
 * This is the Queensland Fire Department's own list, and it is not seven fields
 * for the sake of it. Each one closes off a different way a door can turn out
 * not to be the door the schedule says it is: the standard says which rules it
 * was built to, the FRL says what it holds, the manufacturer and applicant and
 * certifier say who stands behind it, the tag number ties it to the certificate
 * and the schedule of evidence, and the year says which edition of the standard
 * was in force when it was made. A door missing any of them is a door with a
 * gap in its proof.
 */
export const TAG_PARTICULARS: TagParticularSpec[] = [
  {
    key: 'componentStandard',
    label: 'Component standard — AS/NZS 1905.1',
    establishes:
      'That the doorset was built and installed to the fire door standard at all, rather than being a solid door that '
      + 'somebody hung in a fire wall.',
    sourceIds: ['qfd-fire-doors', 'as1905-1'],
  },
  {
    key: 'frl',
    label: 'Fire-resistance level',
    establishes:
      'What the opening is actually protected to, and the only figure on site that can be checked against the '
      + 'schedule and against the wall it sits in.',
    sourceIds: ['qfd-fire-doors', 'as1905-1'],
  },
  {
    key: 'manufacturer',
    label: "Manufacturer's name",
    establishes:
      'Who made the leaf, which is what a recall is traced through — the Korab pyrokor recall of 1999 was worked '
      + 'exactly this way, and those doors were supplied mostly into southern Queensland.',
    sourceIds: ['qfd-fire-doors'],
  },
  {
    key: 'applicant',
    label: "Applicant's name",
    establishes: 'Whose test evidence and whose opinion the doorset was made under.',
    sourceIds: ['qfd-fire-doors', 'as1905-1'],
  },
  {
    key: 'certifier',
    label: 'Certifier',
    establishes:
      'Who inspected the completed installation and affixed the tag, and therefore who certified that the hardware, '
      + 'the hinges, the latching and the clearances were right on the day.',
    sourceIds: ['qfd-fire-doors', 'as1905-1'],
  },
  {
    key: 'tagNumber',
    label: 'Door tag number',
    establishes:
      'The reference that ties this leaf to its certificate and its schedule of evidence, and the number a '
      + 'maintenance record system is kept against.',
    sourceIds: ['qfd-fire-doors', 'as1905-1'],
  },
  {
    key: 'yearOfManufacture',
    label: 'Year of manufacture',
    establishes:
      'Which edition of the standard was current when the leaf was made, and whether the door falls inside the '
      + 'pre-1990 window where the core may be an asbestos containing material.',
    sourceIds: ['qfd-fire-doors'],
  },
];

export interface TagParticulars {
  componentStandard?: string;
  frl?: string;
  manufacturer?: string;
  applicant?: string;
  certifier?: string;
  tagNumber?: string;
  yearOfManufacture?: string;
}

export type TagState = 'present' | 'illegible' | 'missing';

export interface TagRecord {
  state: TagState;
  /** What could be read off it. Absent where the tag is missing or unreadable. */
  particulars?: TagParticulars;
}

/**
 * When a fire door had to be tagged at all — and the one thing Queensland says
 * two different ways.
 *
 * The Queensland Fire Department's current information sheet puts the
 * commencement at 1 April 1976. The superseded 2012 QFRS FAQ put it at
 * 15 May 1975. Both are Queensland Government publications and they cannot both
 * be right. For a building approved in the ten and a half months between them,
 * this app does not pick one: it says the sources disagree and sends the
 * question to the certifier or the local government, which is where the
 * approval record lives anyway.
 */
export const TAG_REQUIRED_FROM = '1976-04-01';
export const TAG_REQUIRED_FROM_SUPERSEDED = '1975-05-15';

export interface TagRequirement {
  /** Three-valued. `undefined` is the honest answer inside the disputed window. */
  required?: boolean;
  reason: string;
  whatToDo?: string;
  confidence: Confidence;
  sourceIds: SourceId[];
}

/**
 * Reads d/m/yyyy and ISO yyyy-mm-dd, and nothing else.
 *
 * It will not read 4/11/1976 as April: this company writes day first and a
 * silently American reading of a building approval date would move a door in
 * and out of the tagging requirement.
 */
export function parseAuDate(text: string): { y: number; m: number; d: number } | undefined {
  const s = (text ?? '').trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const au = s.match(/^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{4})$/);
  let y: number; let m: number; let d: number;
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (au) [y, m, d] = [Number(au[3]), Number(au[2]), Number(au[1])];
  else return undefined;
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const asDate = new Date(Date.UTC(y, m - 1, d));
  if (asDate.getUTCFullYear() !== y || asDate.getUTCMonth() !== m - 1 || asDate.getUTCDate() !== d) return undefined;
  return { y, m, d };
}

/** ISO for comparison and storage; screens and reports print d/m/yyyy. */
export function isoDate(p: { y: number; m: number; d: number }): string {
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** d/m/yyyy, which is the only date format this app prints. */
export function formatAuDate(iso: string): string {
  const p = parseAuDate(iso);
  return p ? `${p.d}/${p.m}/${p.y}` : iso;
}

/**
 * Whether this door was required to be tagged.
 *
 * A door replaced after the commencement date needs a tag whatever the age of
 * the building, so the replacement date is checked first where it is known.
 */
export function tagRequirement(args: {
  /** When the building was approved, d/m/yyyy or ISO. */
  buildingApprovedOn?: string;
  /** When this leaf was replaced, if it has been. */
  doorReplacedOn?: string;
}): TagRequirement {
  const sources: SourceId[] = ['qfd-fire-doors', 'qfrs-faq-2012'];

  const replaced = args.doorReplacedOn ? parseAuDate(args.doorReplacedOn) : undefined;
  if (args.doorReplacedOn && !replaced) {
    return {
      reason: `"${args.doorReplacedOn}" is not a date this app will read. Dates are d/m/yyyy or yyyy-mm-dd.`,
      whatToDo: 'Re-enter the replacement date day first. A month-first date is rejected rather than guessed at.',
      confidence: 'high',
      sourceIds: sources,
    };
  }
  if (replaced && isoDate(replaced) >= TAG_REQUIRED_FROM) {
    return {
      required: true,
      reason:
        `This leaf was replaced on ${formatAuDate(isoDate(replaced))}, after ${formatAuDate(TAG_REQUIRED_FROM)}. A `
        + 'fire door replaced after that date requires tags whatever the age of the building.',
      confidence: 'high',
      sourceIds: sources,
    };
  }

  const approved = args.buildingApprovedOn ? parseAuDate(args.buildingApprovedOn) : undefined;
  if (!args.buildingApprovedOn) {
    return {
      reason:
        'The building approval date is not recorded, and whether tags were required turns on it. This app will not '
        + 'assume a modern building.',
      whatToDo:
        'The approval date is on the certificate of classification or occupancy, or in the local government’s '
        + 'approval records. Until it is known, record the door as untagged rather than as non-compliant.',
      confidence: 'high',
      sourceIds: sources,
    };
  }
  if (!approved) {
    return {
      reason: `"${args.buildingApprovedOn}" is not a date this app will read. Dates are d/m/yyyy or yyyy-mm-dd.`,
      whatToDo: 'Re-enter the approval date day first.',
      confidence: 'high',
      sourceIds: sources,
    };
  }

  const iso = isoDate(approved);
  if (iso >= TAG_REQUIRED_FROM) {
    return {
      required: true,
      reason:
        `The building was approved on ${formatAuDate(iso)}, on or after ${formatAuDate(TAG_REQUIRED_FROM)}. Under the `
        + 'Building Act 1975 all buildings approved after that date require tags to be fitted to the fire doors.',
      confidence: 'high',
      sourceIds: ['qfd-fire-doors'],
    };
  }
  if (iso >= TAG_REQUIRED_FROM_SUPERSEDED) {
    return {
      reason:
        `The building was approved on ${formatAuDate(iso)}, which falls between the two commencement dates Queensland `
        + `has published. The current Queensland Fire Department information sheet gives `
        + `${formatAuDate(TAG_REQUIRED_FROM)}; the superseded 2012 QFRS fire door FAQ gives `
        + `${formatAuDate(TAG_REQUIRED_FROM_SUPERSEDED)}. This app will not choose between two Queensland `
        + 'Government publications.',
      whatToDo:
        'Confirm with the building certifier or the local government which requirement applied to this approval. '
        + 'Either way, record what is on the door: an untagged doorset still cannot be proved to be what the schedule '
        + 'says it is.',
      confidence: 'low',
      sourceIds: sources,
    };
  }
  return {
    required: false,
    reason:
      `The building was approved on ${formatAuDate(iso)}, before the tagging requirement commenced. Buildings approved `
      + 'before that date are not required to have tags fitted unless the local authority required it at the time of '
      + 'approval.',
    whatToDo:
      'Not being required to carry a tag is not the same as being identified. Without a tag this doorset’s FRL '
      + 'cannot be confirmed on site, so it is still recorded as unverifiable rather than as a pass.',
    confidence: 'high',
    sourceIds: ['qfd-fire-doors'],
  };
}

export type TagFinding =
  | 'tag-missing'
  | 'tag-illegible'
  | 'tag-incomplete'
  | 'frame-tag-missing'
  | 'tags-do-not-match'
  | 'frl-mismatch';

export interface TagAssessment {
  /**
   * Whether this door can be proved to be the door the schedule says it is.
   * Three-valued: `false` means it cannot, not that the door is defective.
   */
  identified?: boolean;
  leafState: TagState;
  frameState?: TagState;
  /** Particulars the tag should carry and does not, in the order they are printed. */
  missingParticulars: TagParticularSpec[];
  /** What the tag says the FRL is, where it could be read. */
  tagFrl?: FrlResult;
  frlAgreement?: FrlAgreement;
  requirement: TagRequirement;
  findings: TagFinding[];
  /** The line that belongs in the service report. */
  statement: string;
  /**
   * The defect this raises, where it raises one. Deliberately DOR-FD-004 and
   * never DOR-FD-001: a missing tag is a records and identification defect, not
   * a statement that the door failed to operate.
   */
  defectCode?: string;
  notes: string[];
  sourceIds: SourceId[];
}

export const TAG_DEFECT_CODE = 'DOR-FD-004';

export interface TagInput {
  /** The tag on the edge of the hinge stile of the leaf. */
  leaf: TagRecord;
  /** The matching tag on the doorframe. */
  frame?: TagRecord;
  /** What the register says this door is rated at. */
  scheduleFrl?: string;
  buildingApprovedOn?: string;
  doorReplacedOn?: string;
}

/**
 * What the tag proves, and what it fails to prove.
 *
 * This function never says a door has failed. It answers one question — can
 * this doorset be shown to be the doorset the schedule describes — and the
 * answer is separate from whether it closed and latched, because the two get
 * conflated on site and the conflation runs both ways. A perfectly operating
 * door with no tag is written up as compliant because it worked; a tagged door
 * that would not latch is written up as fine because the tag was there.
 *
 * AS 1905.1 requires matching tags on both the leaf and the frame. A leaf tag
 * with no frame tag is the signature of a leaf that has been changed and a
 * frame that has not, so it gets its own finding rather than being counted as
 * tagged.
 */
export function assessTag(input: TagInput): TagAssessment {
  const sources: SourceId[] = ['qfd-fire-doors', 'as1905-1'];
  const requirement = tagRequirement({
    buildingApprovedOn: input.buildingApprovedOn,
    doorReplacedOn: input.doorReplacedOn,
  });
  const findings: TagFinding[] = [];
  const notes: string[] = [];

  const leafState = input.leaf.state;
  const frameState = input.frame?.state;

  if (leafState === 'missing') {
    findings.push('tag-missing');
    const consequence =
      'The doorset carries no identification tag, so its fire-resistance level, its manufacturer and its certifier '
      + 'cannot be established on site and it cannot be shown to be the door the schedule describes.';
    return {
      identified: false,
      leafState,
      frameState,
      missingParticulars: [...TAG_PARTICULARS],
      requirement,
      findings,
      statement:
        requirement.required === true
          ? `${consequence} Tags were required for this building. ${requirement.reason}`
          : requirement.required === false
            ? `${consequence} Tags were not required when this building was approved, so this is not itself a `
              + 'non-compliance — but the door is still unverified.'
            : `${consequence} Whether tags were required here is unresolved: ${requirement.reason}`,
      defectCode: requirement.required === true ? TAG_DEFECT_CODE : undefined,
      notes: requirement.whatToDo ? [requirement.whatToDo] : [],
      sourceIds: [...sources, ...requirement.sourceIds],
    };
  }

  if (leafState === 'illegible') {
    findings.push('tag-illegible');
    return {
      identified: false,
      leafState,
      frameState,
      missingParticulars: [...TAG_PARTICULARS],
      requirement,
      findings,
      statement:
        'A tag is fitted to the leaf but cannot be read — painted over, corroded or worn. A tag that cannot be read '
        + 'establishes nothing, so this door is in the same position as an untagged one: its rating cannot be '
        + 'confirmed. Note that a tag painted over during a repaint is a maintenance failure in its own right.',
      defectCode: requirement.required === true ? TAG_DEFECT_CODE : undefined,
      notes: [
        'Do not clean or strip a tag to read it without knowing what the leaf core is — pre-1990 doors may contain '
        + 'asbestos and disturbing them is regulated work.',
      ],
      sourceIds: [...sources, ...requirement.sourceIds],
    };
  }

  const particulars = input.leaf.particulars ?? {};
  const missingParticulars = TAG_PARTICULARS.filter((spec) => {
    const value = particulars[spec.key];
    return value === undefined || String(value).trim() === '';
  });
  if (missingParticulars.length > 0) findings.push('tag-incomplete');

  if (input.frame === undefined || frameState === 'missing') {
    findings.push('frame-tag-missing');
    notes.push(
      'AS 1905.1 requires matching tags on both the leaf and the doorframe. A leaf tag with no frame tag is the '
      + 'signature of a leaf swapped into an older frame, or a frame tag lost in a repaint, and either way the pair '
      + 'is no longer self-evidencing.',
    );
  } else if (frameState === 'illegible') {
    findings.push('frame-tag-missing');
    notes.push('The frame tag is fitted but cannot be read, so the pair cannot be checked against each other.');
  }

  const tagFrl = particulars.frl !== undefined ? parseFrl(particulars.frl) : undefined;
  const frlAgreement = compareFrl(particulars.frl, input.scheduleFrl);
  if (frlAgreement.result === 'differs') findings.push('frl-mismatch');

  const frameFrl = input.frame?.particulars?.frl;
  if (frameFrl !== undefined && particulars.frl !== undefined) {
    const pair = compareFrl(particulars.frl, frameFrl);
    if (pair.result === 'differs') {
      findings.push('tags-do-not-match');
      notes.push(
        `The leaf tag and the frame tag give different fire-resistance levels (${particulars.frl} against `
        + `${frameFrl}). One of them belongs to a door that is no longer here.`,
      );
    }
  }

  const identified =
    missingParticulars.length === 0
    && !findings.includes('frame-tag-missing')
    && !findings.includes('tags-do-not-match')
    && frlAgreement.result !== 'differs'
    && (tagFrl === undefined || tagFrl.ok);

  const parts: string[] = [];
  if (identified) {
    parts.push(
      `Identified. The leaf and frame tags carry every particular AS/NZS 1905.1 requires${
        tagFrl && tagFrl.ok ? ` and give an FRL of ${tagFrl.normalised}` : ''}.`,
    );
    if (frlAgreement.result === 'match') parts.push(frlAgreement.statement);
  } else {
    parts.push('Not identified.');
    if (missingParticulars.length > 0) {
      parts.push(
        `The tag does not carry ${missingParticulars.map((p) => p.label.toLowerCase()).join(', ')}.`,
      );
    }
    if (findings.includes('frame-tag-missing')) parts.push('The matching frame tag is missing or unreadable.');
    if (frlAgreement.result === 'differs') parts.push(frlAgreement.statement);
    if (tagFrl && !tagFrl.ok) parts.push(`The FRL on the tag could not be read: ${tagFrl.reason}`);
  }

  return {
    identified,
    leafState,
    frameState,
    missingParticulars,
    tagFrl,
    frlAgreement,
    requirement,
    findings,
    statement: parts.join(' '),
    defectCode: identified ? undefined : (requirement.required === true ? TAG_DEFECT_CODE : undefined),
    notes,
    sourceIds: [...sources, ...requirement.sourceIds],
  };
}

// ---------------------------------------------------------------------------
// Clearance gaps
// ---------------------------------------------------------------------------

export type GapPosition =
  | 'head'
  | 'stile'
  | 'meeting-stile'
  | 'floor'
  | 'sliding-face'
  | 'sliding-overlap';

/** What is on the floor under the leaf, which changes the limit that applies. */
export type FloorCovering =
  /** Bare non-combustible sill or slab, nothing laid on it. */
  | 'none'
  /** A non-combustible covering — tile, vinyl on screed, sealed concrete. */
  | 'non-combustible'
  /** Carpet, underlay, timber overlay: something that will burn. */
  | 'combustible'
  /** Carpet is on its way and the floor is bare on the day. A temporary case. */
  | 'carpet-pending'
  | 'unknown';

export type FrameType = 'rebated' | 'not-rebated' | 'unknown';

/** How a limit is applied to the readings taken. */
export type GapBasis = 'mean' | 'any-point' | 'minimum';

export interface GapLimit {
  position: GapPosition;
  label: string;
  /** Where the reading is taken, in a technician's words. */
  measuredAt: string;
  minMm?: number;
  maxMm?: number;
  basis: GapBasis;
  clause: string;
  confidence: Confidence;
  sourceIds: SourceId[];
  note?: string;
}

/**
 * The clearances this app has a source for, and only those.
 *
 * Every one of these comes from AS 1905.1—2005 Clause 5.5, restated here rather
 * than reproduced, with its clause number attached so it can be checked. The
 * 2005 edition is superseded by AS 1905.1:2015 — the figures below have not
 * been re-read against the 2015 edition, which is why the module says so on
 * every result rather than in a comment somebody will not read.
 *
 * Note what is *not* here. There is no meeting-stile figure for a pair of
 * doors, no clearance for a double-acting doorset, and no gap limit for a smoke
 * door. Those omissions are deliberate and are answered by `UNSOURCED_GAPS`.
 */
export const GAP_LIMITS: GapLimit[] = [
  {
    position: 'head',
    label: 'Leaf to head — side-hung leaf in a rebated frame',
    measuredAt: 'Across the top edge of the closed leaf, several readings, averaged.',
    maxMm: 3,
    basis: 'mean',
    clause: 'AS 1905.1—2005 Clause 5.5.3',
    confidence: 'high',
    sourceIds: ['as1905-1'],
    note: 'The limit is on the mean across the edge, not on the worst single reading.',
  },
  {
    position: 'stile',
    label: 'Leaf to stile — side-hung leaf in a rebated frame',
    measuredAt: 'Down each vertical edge of the closed leaf, several readings each side, averaged per edge.',
    maxMm: 3,
    basis: 'mean',
    clause: 'AS 1905.1—2005 Clause 5.5.3',
    confidence: 'high',
    sourceIds: ['as1905-1'],
    note: 'Each stile is averaged on its own. A tight hinge stile does not offset a wide lock stile.',
  },
  {
    position: 'floor',
    label: 'Leaf to the top of a floor covering',
    measuredAt: 'Under the closed leaf, to the top of whatever is laid on the floor.',
    minMm: 3,
    maxMm: 10,
    basis: 'any-point',
    clause: 'AS 1905.1—2005 Clause 5.5.2(a)',
    confidence: 'high',
    sourceIds: ['as1905-1'],
    note:
      'There is a minimum as well as a maximum. A leaf binding on the carpet is a door that will not close under its '
      + 'own closer, which is a closing failure dressed up as a tight fit.',
  },
  {
    position: 'sliding-face',
    label: 'Sliding leaf to the frame or wall face, within the overlap',
    measuredAt: 'Between the face of the closed leaf and the return of the frame or the wall face, top and sides.',
    maxMm: 10,
    basis: 'mean',
    clause: 'AS 1905.1—2005 Clause 5.5.5(b) and (c)',
    confidence: 'high',
    sourceIds: ['as1905-1'],
    note: 'The mean may not exceed 10 mm and no single reading may exceed 15 mm.',
  },
  {
    position: 'sliding-overlap',
    label: 'Sliding leaf overlap onto each jamb and the head',
    measuredAt: 'How far the closed leaf covers past the clear opening at each jamb and at the head.',
    minMm: 75,
    basis: 'minimum',
    clause: 'AS 1905.1—2005 Clause 5.5.5(a)',
    confidence: 'high',
    sourceIds: ['as1905-1'],
    note: 'This one is a minimum, not a maximum. Too little overlap is the failure.',
  },
];

/** The single-reading ceiling on a sliding doorset face clearance. */
export const SLIDING_FACE_ANY_POINT_MAX_MM = 15;

/** The floor clearance where the leaf sits over a bare non-combustible sill. */
export const FLOOR_MAX_OVER_NON_COMBUSTIBLE_SILL_MM = 10;

/**
 * The floor clearance tolerated while carpet is being laid, and nothing else.
 *
 * AS 1905.1 allows a larger gap to a non-combustible sill where a combustible
 * floor covering is present, and its own commentary is explicit that the
 * allowance exists to accommodate the thickness of carpet and underlay, not to
 * permit a 25 mm gap under a finished door. It is a certification-day
 * concession that has to be noted in the evidence of compliance and checked at
 * the first maintenance inspection — which is this inspection.
 */
export const FLOOR_MAX_CARPET_PENDING_MM = 25;

export interface Refusal {
  known: false;
  reason: string;
  /** What the technician should do to get an answer. */
  whatToDo: string;
  sourceIds: SourceId[];
}

/**
 * The gaps this app deliberately has no number for.
 *
 * Every one of these has a number that circulates on site. None of them has a
 * number this app can source, and a clearance quoted in a report is a figure a
 * client may spend money against, so each returns a refusal that says where the
 * real figure lives.
 */
export const UNSOURCED_GAPS: Record<'meeting-stile' | 'double-acting' | 'smoke-door', {
  what: string;
  why: string;
  whatToDo: string;
  sourceIds: SourceId[];
}> = {
  'meeting-stile': {
    what: 'The gap between the two leaves of a pair, at the meeting stiles',
    why:
      'AS 1905.1 Clause 5.5.3 gives a mean clearance between the leaf and the head and between the leaf and each '
      + 'stile of the frame. It does not give a leaf-to-leaf figure, and this app has not found one it can cite. The '
      + 'three millimetres everybody quotes is the frame figure being carried across to a joint it was not written '
      + 'for.',
    whatToDo:
      'Read the clearance off the doorset’s own test evidence or the certifier’s opinion, which is what '
      + 'governs a variation from the tested specimen. Record the measurement either way — it is evidence even '
      + 'without a limit to hold it to.',
    sourceIds: ['as1905-1'],
  },
  'double-acting': {
    what: 'Any clearance around a double-acting leaf',
    why:
      'AS 1905.1 Clause 5.5.4 sets no figure for a double-acting doorset. It requires the clearances to be no greater '
      + 'than needed to operate the door and, in every case, no greater than those of the specimen that passed the '
      + 'fire test. The limit is a property of that particular doorset, not of the standard, so there is no number '
      + 'here to check against.',
    whatToDo:
      'Get the test report or the registered testing authority’s opinion for this doorset and read the tested '
      + 'clearances off it. Until then, record the measurements and report that no limit could be established.',
    sourceIds: ['as1905-1'],
  },
  'smoke-door': {
    what: 'A permitted gap around a smoke door',
    why:
      'A smoke door is not gap-limited in the way a fire doorset is. What the NCC requires of it is smoke seals, a '
      + 'leaf that is solid core or smoke resisting, and that it returns to the closed position. The seal is the '
      + 'test, not the gap behind it, and inventing a millimetre figure for a smoke door would fail doors that are '
      + 'sealing and pass doors that are not.',
    whatToDo:
      'Assess the seals: continuous, in contact along their length, not painted, not torn, not worn flat. Record '
      + 'seal condition rather than a gap measurement.',
    sourceIds: ['ncc-spec-12'],
  },
};

/** How many readings good practice takes before a mean means anything. */
export const RECOMMENDED_READINGS = { vertical: 3, horizontal: 2 } as const;

export interface GapCheck {
  known: true;
  position: GapPosition;
  limit: GapLimit;
  /** The reading the limit is applied to — the mean, the worst point or the least overlap. */
  valueMm: number;
  readingsMm: number[];
  /** The largest single reading, which matters where a single-point ceiling applies. */
  worstMm: number;
  within: boolean;
  statement: string;
  defectCode?: string;
  notes: string[];
  confidence: Confidence;
  sourceIds: SourceId[];
}

const GAP_DEFECT_CODE = 'DOR-FD-003';

const EDITION_CAVEAT =
  'Figure restated from AS 1905.1—2005, which is superseded by AS 1905.1:2015. Re-read it against the current '
  + 'edition before it is quoted to a client.';

const round1 = (n: number) => Math.round(n * 10) / 10;

function meanOf(readings: number[]): number {
  return round1(readings.reduce((a, b) => a + b, 0) / readings.length);
}

/**
 * Check a measured clearance against the limit that actually applies.
 *
 * The limit is not a property of the position alone — it depends on the leaf
 * action, on whether the frame is rebated and on what is on the floor — so all
 * of those are arguments and any of them being unknown is a refusal rather than
 * an assumption. That is the point of the function: "3 mm around and 10 under"
 * is right for one configuration and this makes you say which one you are in.
 */
export function checkGap(args: {
  position: GapPosition;
  /** Every reading taken along that edge, in millimetres. */
  readingsMm: number[];
  doorType: DoorType;
  leafAction: LeafAction;
  frame?: FrameType;
  floorCovering?: FloorCovering;
  /** True where this edge is the joint between two leaves of a pair. */
  meetingStile?: boolean;
}): GapCheck | Refusal {
  const readings = args.readingsMm ?? [];

  if (readings.length === 0 || readings.some((r) => !Number.isFinite(r))) {
    return {
      known: false,
      reason: 'No usable measurement was recorded for this edge.',
      whatToDo: 'Measure the gap with a feeler gauge or a tapered gap gauge and record every reading in millimetres.',
      sourceIds: ['as1905-1'],
    };
  }
  if (readings.some((r) => r < 0)) {
    return {
      known: false,
      reason: 'A negative clearance was recorded, which is not a measurement.',
      whatToDo: 'Record the gap as a positive number of millimetres. A leaf binding on the frame is zero, not less.',
      sourceIds: ['as1905-1'],
    };
  }

  if (args.meetingStile || args.position === 'meeting-stile') {
    const u = UNSOURCED_GAPS['meeting-stile'];
    return { known: false, reason: `${u.what}: ${u.why}`, whatToDo: u.whatToDo, sourceIds: u.sourceIds };
  }

  if (args.doorType === 'smoke' && args.position !== 'floor') {
    const u = UNSOURCED_GAPS['smoke-door'];
    return { known: false, reason: `${u.what}: ${u.why}`, whatToDo: u.whatToDo, sourceIds: u.sourceIds };
  }

  if (args.leafAction === 'double-acting') {
    const u = UNSOURCED_GAPS['double-acting'];
    return { known: false, reason: `${u.what}: ${u.why}`, whatToDo: u.whatToDo, sourceIds: u.sourceIds };
  }

  const worst = round1(Math.max(...readings));
  const least = round1(Math.min(...readings));
  const notes: string[] = [EDITION_CAVEAT];

  const readingCountNote = (want: number) => {
    if (readings.length === 1) return undefined;
    if (readings.length < want) {
      return `Averaged from ${readings.length} readings; good practice takes at least ${want} along this edge, `
        + 'spaced not less than 750 mm apart.';
    }
    return undefined;
  };

  const find = (p: GapPosition) => GAP_LIMITS.find((l) => l.position === p)!;

  if (args.position === 'head' || args.position === 'stile') {
    if (args.leafAction === 'sliding') {
      return {
        known: false,
        reason:
          'Head and stile clearances under Clause 5.5.3 are written for a side-hung leaf in a rebated frame. A '
          + 'sliding doorset is measured differently — face clearance within the overlap, and the overlap itself.',
        whatToDo: 'Record this as a sliding face clearance and a sliding overlap instead.',
        sourceIds: ['as1905-1'],
      };
    }
    const frame = args.frame ?? 'unknown';
    if (frame !== 'rebated') {
      return {
        known: false,
        reason:
          frame === 'unknown'
            ? 'Whether the doorframe is rebated was not recorded, and the 3 mm mean clearance in Clause 5.5.3 is '
              + 'written for a leaf side-hung into a rebated frame.'
            : 'This leaf is not hung into a rebated frame, and the 3 mm mean clearance in Clause 5.5.3 is written for '
              + 'one that is.',
        whatToDo:
          'Check the frame section: a rebated frame has the leaf swinging clear into a rebate with a doorstop formed '
          + 'in the profile. If it is not rebated, the governing clearance is the one on the doorset’s own test '
          + 'evidence.',
        sourceIds: ['as1905-1'],
      };
    }
    if (readings.length === 1) {
      return {
        known: false,
        reason:
          `A single reading of ${least} mm cannot establish a mean clearance, and Clause 5.5.3 is written against the `
          + 'mean rather than any one point.',
        whatToDo:
          `Take at least ${RECOMMENDED_READINGS.vertical} readings down each stile and `
          + `${RECOMMENDED_READINGS.horizontal} across the head, spaced not less than 750 mm apart, and record them `
          + 'all.',
        sourceIds: ['as1905-1', 'trade-gap-method'],
      };
    }
    const limit = find(args.position);
    const want = args.position === 'stile' ? RECOMMENDED_READINGS.vertical : RECOMMENDED_READINGS.horizontal;
    const countNote = readingCountNote(want);
    if (countNote) notes.push(countNote);
    const mean = meanOf(readings);
    const within = mean <= limit.maxMm!;
    return {
      known: true,
      position: args.position,
      limit,
      valueMm: mean,
      readingsMm: readings,
      worstMm: worst,
      within,
      statement: within
        ? `Mean clearance ${mean} mm across ${readings.length} readings, within the ${limit.maxMm} mm mean allowed by `
          + `${limit.clause}.`
        : `Mean clearance ${mean} mm across ${readings.length} readings, against a ${limit.maxMm} mm mean under `
          + `${limit.clause}. A gap this size lets hot gas past the leaf before the core has been tested at all.`,
      defectCode: within ? undefined : GAP_DEFECT_CODE,
      notes,
      confidence: limit.confidence,
      sourceIds: [...limit.sourceIds, 'trade-gap-method'],
    };
  }

  if (args.position === 'floor') {
    const covering = args.floorCovering ?? 'unknown';
    if (covering === 'unknown') {
      return {
        known: false,
        reason:
          'The floor clearance limit depends on what is under the leaf and that was not recorded. AS 1905.1 gives a '
          + '3 mm to 10 mm range to the top of a floor covering, a 10 mm maximum to a bare non-combustible sill, and '
          + 'a 25 mm concession where a combustible covering is being laid. Those are three different answers.',
        whatToDo:
          'Look at what is actually under the door — bare sill, tile or vinyl, carpet down, or carpet not yet laid — '
          + 'and record it with the measurement.',
        sourceIds: ['as1905-1'],
      };
    }

    const limit = find('floor');
    if (covering === 'carpet-pending') {
      const within = worst <= FLOOR_MAX_CARPET_PENDING_MM;
      return {
        known: true,
        position: 'floor',
        limit: {
          ...limit,
          label: 'Leaf to a bare non-combustible sill with a combustible floor covering still to be laid',
          minMm: undefined,
          maxMm: FLOOR_MAX_CARPET_PENDING_MM,
          basis: 'any-point',
          clause: 'AS 1905.1—2005 Clause 5.5.2(b)(ii) and its commentary',
          confidence: 'medium',
        },
        valueMm: worst,
        readingsMm: readings,
        worstMm: worst,
        within,
        statement: within
          ? `${worst} mm under the leaf, inside the ${FLOOR_MAX_CARPET_PENDING_MM} mm allowed only while a combustible `
            + 'floor covering is being laid. This is a concession for certification day, not a clearance a finished '
            + 'door may keep.'
          : `${worst} mm under the leaf, past even the ${FLOOR_MAX_CARPET_PENDING_MM} mm concession allowed while a `
            + 'covering is being laid.',
        defectCode: within ? undefined : GAP_DEFECT_CODE,
        notes: [
          ...notes,
          'This concession only holds if a note was made in the evidence of compliance at certification and the '
          + 'covering is genuinely still being laid. This inspection is where that gets checked: if the carpet is '
          + 'down, the door is measured to the top of it against 3 mm to 10 mm and this reading is a defect.',
        ],
        confidence: 'medium',
        sourceIds: ['as1905-1'],
      };
    }

    if (covering === 'none') {
      const within = worst <= FLOOR_MAX_OVER_NON_COMBUSTIBLE_SILL_MM;
      return {
        known: true,
        position: 'floor',
        limit: {
          ...limit,
          label: 'Leaf to a bare non-combustible sill',
          minMm: undefined,
          maxMm: FLOOR_MAX_OVER_NON_COMBUSTIBLE_SILL_MM,
          basis: 'any-point',
          clause: 'AS 1905.1—2005 Clause 5.5.2(b)(i)',
        },
        valueMm: worst,
        readingsMm: readings,
        worstMm: worst,
        within,
        statement: within
          ? `${worst} mm to the sill, within the ${FLOOR_MAX_OVER_NON_COMBUSTIBLE_SILL_MM} mm maximum where there is `
            + 'no combustible floor covering.'
          : `${worst} mm to the sill, against a ${FLOOR_MAX_OVER_NON_COMBUSTIBLE_SILL_MM} mm maximum where there is `
            + 'no combustible floor covering.',
        defectCode: within ? undefined : GAP_DEFECT_CODE,
        notes,
        confidence: limit.confidence,
        sourceIds: limit.sourceIds,
      };
    }

    const withinMax = worst <= limit.maxMm!;
    const withinMin = least >= limit.minMm!;
    const within = withinMax && withinMin;
    return {
      known: true,
      position: 'floor',
      limit,
      valueMm: withinMax ? least : worst,
      readingsMm: readings,
      worstMm: worst,
      within,
      statement: within
        ? `${least} mm to ${worst} mm to the top of the floor covering, inside the ${limit.minMm} mm to `
          + `${limit.maxMm} mm range in ${limit.clause}.`
        : !withinMax
          ? `${worst} mm to the top of the floor covering, against a ${limit.maxMm} mm maximum under ${limit.clause}.`
          : `${least} mm to the top of the floor covering, under the ${limit.minMm} mm minimum in ${limit.clause}. `
            + 'Too little clearance is a door that binds and does not close under its own closer.',
      defectCode: within ? undefined : GAP_DEFECT_CODE,
      notes,
      confidence: limit.confidence,
      sourceIds: limit.sourceIds,
    };
  }

  if (args.position === 'sliding-face') {
    if (args.leafAction !== 'sliding') {
      return {
        known: false,
        reason: 'A sliding face clearance was recorded against a leaf that is not a sliding doorset.',
        whatToDo: 'Check the leaf action. A side-hung leaf is measured at the head and stiles instead.',
        sourceIds: ['as1905-1'],
      };
    }
    const limit = find('sliding-face');
    const mean = meanOf(readings);
    const within = mean <= limit.maxMm! && worst <= SLIDING_FACE_ANY_POINT_MAX_MM;
    return {
      known: true,
      position: 'sliding-face',
      limit,
      valueMm: mean,
      readingsMm: readings,
      worstMm: worst,
      within,
      statement: within
        ? `Mean face clearance ${mean} mm with a worst point of ${worst} mm, inside the ${limit.maxMm} mm mean and `
          + `${SLIDING_FACE_ANY_POINT_MAX_MM} mm single-point limits in ${limit.clause}.`
        : mean > limit.maxMm!
          ? `Mean face clearance ${mean} mm, against a ${limit.maxMm} mm mean under ${limit.clause}.`
          : `Mean face clearance ${mean} mm is inside the ${limit.maxMm} mm mean, but a single reading of ${worst} mm `
            + `exceeds the ${SLIDING_FACE_ANY_POINT_MAX_MM} mm allowed at any point under ${limit.clause}.`,
      defectCode: within ? undefined : GAP_DEFECT_CODE,
      notes,
      confidence: limit.confidence,
      sourceIds: limit.sourceIds,
    };
  }

  // sliding-overlap
  if (args.leafAction !== 'sliding') {
    return {
      known: false,
      reason: 'An overlap was recorded against a leaf that is not a sliding doorset.',
      whatToDo: 'Only a horizontally sliding doorset has an overlap onto the jambs and head.',
      sourceIds: ['as1905-1'],
    };
  }
  const limit = find('sliding-overlap');
  const within = least >= limit.minMm!;
  return {
    known: true,
    position: 'sliding-overlap',
    limit,
    valueMm: least,
    readingsMm: readings,
    worstMm: worst,
    within,
    statement: within
      ? `Least overlap ${least} mm, at or above the ${limit.minMm} mm minimum at each jamb and the head under `
        + `${limit.clause}.`
      : `Least overlap ${least} mm, under the ${limit.minMm} mm minimum required at each jamb and the head by `
        + `${limit.clause}. Too little overlap leaves a path straight past the edge of the leaf.`,
    defectCode: within ? undefined : GAP_DEFECT_CODE,
    notes,
    confidence: limit.confidence,
    sourceIds: limit.sourceIds,
  };
}

// ---------------------------------------------------------------------------
// Self-closing and latching
// ---------------------------------------------------------------------------

/** Where the leaf was released from. Clause 5.7 wants more than one. */
export type ReleasePosition = 'fully-open' | 'intermediate' | 'small-opening';

/** What is holding the door open, if anything. */
export type HoldOpen =
  | 'none'
  | 'approved-device'
  | 'wedge'
  | 'furniture'
  | 'tied-or-hooked'
  | 'hardware-fault';

export type SealState = 'intact' | 'damaged' | 'missing' | 'not-fitted' | 'not-checked';

export type ClosingOutcome =
  | 'closed-and-latched'
  | 'closed-not-latched'
  | 'closed-no-latch-required'
  | 'did-not-close'
  | 'held-open'
  | 'not-tested';

export interface ClosingInput {
  doorType: DoorType;
  leafAction: LeafAction;
  /** Every position the leaf was released from. Empty means nothing was tested. */
  releasedFrom: ReleasePosition[];
  /** Whether the leaf came fully to the closed position under its own closer. */
  closedFully?: boolean;
  /** Whether the latch engaged. Leave undefined where there is no latch to test. */
  latched?: boolean;
  heldOpenBy?: HoldOpen;
  /** Whether an approved hold-open device released on the alarm when it was tested. */
  holdOpenReleasedOnAlarm?: boolean;
}

export interface ClosingVerdict {
  outcome: ClosingOutcome;
  /** Three-valued. `undefined` is "not established", never a quiet pass. */
  passed?: boolean;
  statement: string;
  reason?: string;
  defectCode?: string;
  notes: string[];
  sourceIds: SourceId[];
}

export const CLOSING_DEFECT_CODE = 'DOR-FD-001';
export const HELD_OPEN_DEFECT_CODE = 'DOR-FD-002';

/**
 * The closing and latching checks, and the one place this module is emphatic.
 *
 * `closed-not-latched` is a failure on a side-hung fire doorset and an
 * observation on a smoke door, and everything about that difference is in
 * `latchingApplies`. It is the single most argued-about call on a fire door
 * service and it turns on the same fact both ways: what the doorset was
 * certified as. A fire-resistant doorset is certified latching from the fully
 * open position and from any intermediate position, so a leaf that comes to
 * rest against its stop without engaging is not the certified assembly. A smoke
 * door is certified to return to the closed position, and that is all.
 *
 * Releasing the door from one position proves less than people think. A closer
 * with a weak final snap will shut a door from wide open on momentum and leave
 * it 40 mm short from part open, which is the position a door is actually in
 * when someone lets go of it. Testing only from fully open gets no verdict here.
 */
export function assessClosing(input: ClosingInput): ClosingVerdict {
  const latching = latchingApplies(input.doorType, input.leafAction);
  const sources: SourceId[] = ['as1905-1', 'ncc-spec-12', 'qfd-fire-doors'];
  const notes: string[] = [];

  const held = input.heldOpenBy ?? 'none';
  if (held === 'wedge' || held === 'furniture' || held === 'tied-or-hooked') {
    const how = {
      wedge: 'a wedge or chock',
      furniture: 'furniture or stored goods',
      'tied-or-hooked': 'being tied back or hooked open',
    }[held];
    return {
      outcome: 'held-open',
      passed: false,
      statement:
        `Found held open by ${how}. A door held open by anything that does not release on fire alarm is not doing its `
        + 'job at all, and nothing else about the door changes that.',
      defectCode: HELD_OPEN_DEFECT_CODE,
      notes: [
        'The Queensland Fire Department is explicit that chocking a fire door in this way is illegal and will incur a '
        + 'penalty, and the occupier carries a standing obligation under the Fire Services Act 1990 to maintain every '
        + 'prescribed fire safety installation.',
        'Where the occupier needs the door to stand open, the fix is an approved hold-open device released by smoke '
        + 'detection, not a better wedge.',
      ],
      sourceIds: [...sources, 'fire-services-act'],
    };
  }

  if (held === 'hardware-fault') {
    return {
      outcome: 'did-not-close',
      passed: false,
      statement:
        'The door was standing open because its own hardware was holding it there — a seized closer, a failed arm, a '
        + 'hinge that has dropped the leaf onto the floor. The door is open and nothing on site is going to close it.',
      defectCode: CLOSING_DEFECT_CODE,
      notes,
      sourceIds: sources,
    };
  }

  if (held === 'approved-device') {
    if (input.holdOpenReleasedOnAlarm === undefined) {
      return {
        outcome: 'not-tested',
        statement:
          'The door is held open by an approved hold-open device and the release was not tested at this attendance.',
        reason:
          'An untested hold-open device is an open doorway until it is proved otherwise. The device is released by '
          + 'the detection system, so the test belongs with the detection service — record it there and reference it '
          + 'here rather than leaving the door with no result.',
        notes: [
          'The releasing detector must be in the airstream through the open doorway; where it is on the ceiling it is '
          + 'set back from the opening. A device that never releases because the detector is in the wrong place will '
          + 'look perfect on every visual inspection.',
        ],
        sourceIds: sources,
      };
    }
    if (!input.holdOpenReleasedOnAlarm) {
      return {
        outcome: 'held-open',
        passed: false,
        statement:
          'The hold-open device did not release on alarm. The door stays open in a fire, which makes it worse than a '
          + 'door somebody wedged — nobody will notice this one.',
        defectCode: HELD_OPEN_DEFECT_CODE,
        notes,
        sourceIds: sources,
      };
    }
    notes.push('Hold-open device released on alarm; the closing checks below were made after release.');
  }

  const released = input.releasedFrom ?? [];
  if (released.length === 0 || input.closedFully === undefined) {
    return {
      outcome: 'not-tested',
      statement: 'Self-closing was not tested at this attendance.',
      reason:
        'A door that was looked at but not released proves nothing. Open it and let it go — that is the whole test '
        + 'and it takes ten seconds.',
      notes,
      sourceIds: sources,
    };
  }

  if (!input.closedFully) {
    return {
      outcome: 'did-not-close',
      passed: false,
      statement:
        `Released from ${released.join(' and ')} and did not come fully to the closed position. An opening that is `
        + 'part closed is an opening.',
      defectCode: CLOSING_DEFECT_CODE,
      notes: [
        ...notes,
        'Common causes in this order: a closer out of adjustment or leaking, a dropped hinge binding the leaf on the '
        + 'floor or frame, carpet fitted after the door, and a latch or seal fouling on the strike.',
      ],
      sourceIds: sources,
    };
  }

  const testedFullyOpen = released.includes('fully-open');
  const testedIntermediate = released.includes('intermediate') || released.includes('small-opening');
  if (!testedFullyOpen || !testedIntermediate) {
    notes.push(
      'AS 1905.1 Clause 5.7 asks that the doorset closes and latches from the fully open position and from any '
      + `intermediate position. Only ${released.join(' and ')} was tested here, so the result below is partial.`,
    );
  }

  if (!latching.applies) {
    return {
      outcome: 'closed-no-latch-required',
      passed: !testedFullyOpen || !testedIntermediate ? undefined : true,
      statement:
        `Returned fully to the closed position from ${released.join(' and ')}. ${latching.reason}`,
      reason: !testedFullyOpen || !testedIntermediate
        ? 'Only one release position was tested, so the door has not been shown to close from every position it will '
          + 'actually be left in.'
        : undefined,
      notes,
      sourceIds: [...sources, ...latching.sourceIds],
    };
  }

  if (input.latched === undefined) {
    return {
      outcome: 'closed-not-latched',
      statement:
        `Closed fully from ${released.join(' and ')}, but whether the latch engaged was not recorded.`,
      reason:
        'On a side-hung doorset closing and latching are two separate results and only one of them is here. Push the '
        + 'closed leaf: if it moves off the stop, it has not latched.',
      notes,
      sourceIds: [...sources, ...latching.sourceIds],
    };
  }

  if (input.latched) {
    return {
      outcome: 'closed-and-latched',
      passed: !testedFullyOpen || !testedIntermediate ? undefined : true,
      statement: `Closed and latched from ${released.join(' and ')}.`,
      reason: !testedFullyOpen || !testedIntermediate
        ? 'Only one release position was tested, so this is not yet the full check Clause 5.7 describes.'
        : undefined,
      notes,
      sourceIds: [...sources, ...latching.sourceIds],
    };
  }

  if (latching.isFailure) {
    return {
      outcome: 'closed-not-latched',
      passed: false,
      statement:
        `Closed fully from ${released.join(' and ')} but did not latch. ${latching.reason}`,
      defectCode: CLOSING_DEFECT_CODE,
      notes: [
        ...notes,
        'This is a failure and not an observation. A leaf resting against its stop is not the assembly that was '
        + 'tested, and it is the one condition on a fire door that looks completely correct from across the corridor.',
      ],
      sourceIds: [...sources, ...latching.sourceIds],
    };
  }

  return {
    outcome: 'closed-not-latched',
    passed: true,
    statement:
      `Returned fully to the closed position from ${released.join(' and ')}. A latch is fitted and did not engage, `
      + `which is recorded as an observation rather than a defect. ${latching.reason}`,
    notes: [
      ...notes,
      'If this opening is also a required fire door, change the door type: the same observation becomes a defect.',
    ],
    sourceIds: [...sources, ...latching.sourceIds],
  };
}

// ---------------------------------------------------------------------------
// Signage
// ---------------------------------------------------------------------------

export interface SignWording {
  /** Which era of the code this wording belongs to. */
  era: 'current' | 'earlier';
  heldOpen: string;
  selfClosing: string;
  dischargingFromFireIsolatedExit: string;
  clause: string;
  sourceIds: SourceId[];
}

/** Capital letters, at least this high, contrasting with the background. */
export const SIGN_MIN_LETTER_HEIGHT_MM = 20;

/**
 * The two wordings, because signage complies with what applied at approval.
 *
 * An older building carrying "FIRE (SMOKE) DOOR — DO NOT OBSTRUCT" is not
 * defective for not saying "FIRE SAFETY DOOR": the requirement is the one that
 * applied when the building was approved, and the current code is what the
 * Queensland Fire Department *recommends* for new signage. Failing an old sign
 * against a new wording is a defect raised against a compliant building.
 */
export const SIGN_WORDINGS: SignWording[] = [
  {
    era: 'current',
    heldOpen: 'FIRE SAFETY DOOR\nDO NOT OBSTRUCT',
    selfClosing: 'FIRE SAFETY DOOR\nDO NOT OBSTRUCT\nDO NOT KEEP OPEN',
    dischargingFromFireIsolatedExit: 'FIRE SAFETY DOOR\nDO NOT OBSTRUCT',
    clause: 'NCC 2022 D3D28 (BCA D2.23 in earlier editions)',
    sourceIds: ['ncc-d3-signs', 'qfd-fire-doors'],
  },
  {
    era: 'earlier',
    heldOpen: 'FIRE (SMOKE) DOOR - DO NOT OBSTRUCT',
    selfClosing: 'FIRE (SMOKE) DOOR\nDO NOT OBSTRUCT\nDO NOT KEEP OPEN',
    dischargingFromFireIsolatedExit: 'FIRE SAFETY DOOR - DO NOT OBSTRUCT',
    clause: 'BCA D2.23, earlier editions',
    sourceIds: ['ncc-d3-signs'],
  },
];

/**
 * What this door's sign should say.
 *
 * Refuses where the era is not known, because both wordings are correct for
 * some building and neither is correct for all of them.
 */
export function requiredSignWording(args: {
  era?: 'current' | 'earlier';
  heldOpenByDevice: boolean;
}): { wording: string; letterHeightMm: number; clause: string; sourceIds: SourceId[] } | Refusal {
  if (!args.era) {
    return {
      known: false,
      reason:
        'Fire door signage complies with the requirement that applied when the building was approved, and which '
        + 'wording that is was not established.',
      whatToDo:
        'Record the building approval era, or record what the existing sign says and leave the wording question to '
        + 'the certifier. A legible existing sign is not a defect merely for using older words.',
      sourceIds: ['ncc-d3-signs', 'qfd-fire-doors'],
    };
  }
  const set = SIGN_WORDINGS.find((w) => w.era === args.era)!;
  return {
    wording: args.heldOpenByDevice ? set.heldOpen : set.selfClosing,
    letterHeightMm: SIGN_MIN_LETTER_HEIGHT_MM,
    clause: set.clause,
    sourceIds: set.sourceIds,
  };
}

// ---------------------------------------------------------------------------
// The per-door verdict
// ---------------------------------------------------------------------------

export type CheckResult = 'pass' | 'fail' | 'no-verdict' | 'not-applicable';

export interface DoorCheck {
  id: string;
  label: string;
  result: CheckResult;
  statement: string;
  /** Why it matters, for the technician reading it and for the report. */
  meaning?: string;
  defectCode?: string;
  sourceIds: SourceId[];
}

export type DoorOutcome = 'pass' | 'fail' | 'unverifiable' | 'not-assessed';

export interface GapMeasurement {
  position: GapPosition;
  readingsMm: number[];
  floorCovering?: FloorCovering;
  meetingStile?: boolean;
}

export interface DoorInput {
  assetId: string;
  location?: string;
  doorType: DoorType;
  leafAction: LeafAction;
  frame?: FrameType;
  /** What the register says this door is rated at. */
  scheduleFrl?: string;
  closing?: ClosingInput;
  gaps?: GapMeasurement[];
  tag?: TagInput;
  smokeSeals?: SealState;
  /** Set where the door could not be reached or opened at this attendance. */
  notAssessedReason?: string;
}

export interface DoorVerdict {
  assetId: string;
  location?: string;
  doorType: DoorType;
  leafAction: LeafAction;
  outcome: DoorOutcome;
  /**
   * Deliberately optional. `undefined` is the answer for a door that was not
   * assessed or could not be identified; a caller treating it as false raises a
   * defect against a working door, and one treating it as true signs off a door
   * nobody proved anything about.
   */
  passed?: boolean;
  /** Whether the door can be shown to be the door the schedule describes. */
  identified?: boolean;
  checks: DoorCheck[];
  failedChecks: DoorCheck[];
  checksWithoutVerdict: DoorCheck[];
  /** The line that belongs in the service report. */
  statement: string;
  /** Present whenever there is no pass or fail, saying what is missing. */
  reason?: string;
  defectCodes: string[];
  notes: string[];
  sourceIds: SourceId[];
}

/**
 * One door, all its checks, and one honest answer.
 *
 * The ordering of outcomes is the design. A failed performance check beats
 * everything: a door that will not latch is a failure whether or not it has a
 * tag. Below that, a door that passed everything it was asked but could not be
 * identified is `unverifiable` — not a pass, because nobody has shown it is the
 * door the schedule says, and not a failure, because it did everything a door
 * has to do. Only a door that both worked and could be identified passes.
 *
 * `not-assessed` is kept separate from all three, because a door nobody reached
 * is the one thing a site rollup must never treat as a result.
 */
export function assessDoor(input: DoorInput): DoorVerdict {
  const profile = DOOR_TYPES[input.doorType];
  const checks: DoorCheck[] = [];
  const notes: string[] = [];
  const sourceIds: SourceId[] = ['qdc-mp61'];

  if (input.notAssessedReason) {
    return {
      assetId: input.assetId,
      location: input.location,
      doorType: input.doorType,
      leafAction: input.leafAction,
      outcome: 'not-assessed',
      checks: [],
      failedChecks: [],
      checksWithoutVerdict: [],
      statement: `Not assessed at this attendance: ${input.notAssessedReason}`,
      reason:
        'A door that was not reached has no result. It is neither a pass nor a defect, and it stops this site from '
        + 'being called compliant until it is done.',
      defectCodes: [],
      notes: [],
      sourceIds,
    };
  }

  // ---- closing and latching
  if (input.closing) {
    const closing = assessClosing({ ...input.closing, doorType: input.doorType, leafAction: input.leafAction });
    checks.push({
      id: 'closing',
      label: 'Self-closing and latching',
      result: closing.passed === true ? 'pass' : closing.passed === false ? 'fail' : 'no-verdict',
      statement: closing.reason ? `${closing.statement} ${closing.reason}` : closing.statement,
      meaning:
        'The one check that decides whether the opening is protected at the moment it matters. Everything else on '
        + 'this door assumes it is closed.',
      defectCode: closing.defectCode,
      sourceIds: closing.sourceIds,
    });
    notes.push(...closing.notes);
    sourceIds.push(...closing.sourceIds);
  } else {
    checks.push({
      id: 'closing',
      label: 'Self-closing and latching',
      result: 'no-verdict',
      statement: 'Not recorded. The door was not released and allowed to close.',
      sourceIds: ['as1905-1'],
    });
  }

  // ---- clearances
  for (const gap of input.gaps ?? []) {
    const result = checkGap({
      position: gap.position,
      readingsMm: gap.readingsMm,
      doorType: input.doorType,
      leafAction: input.leafAction,
      frame: input.frame,
      floorCovering: gap.floorCovering,
      meetingStile: gap.meetingStile,
    });
    if (result.known) {
      checks.push({
        id: `gap-${gap.position}${gap.meetingStile ? '-meeting' : ''}`,
        label: result.limit.label,
        result: result.within ? 'pass' : 'fail',
        statement: result.statement,
        meaning: result.limit.note,
        defectCode: result.defectCode,
        sourceIds: result.sourceIds,
      });
      sourceIds.push(...result.sourceIds);
    } else {
      checks.push({
        id: `gap-${gap.position}${gap.meetingStile ? '-meeting' : ''}`,
        label: `Clearance — ${gap.position}`,
        result: 'no-verdict',
        statement: `${result.reason} ${result.whatToDo}`,
        meaning:
          'Recorded as a measurement without a limit. This is not a pass: no figure this app can source applies to '
          + 'this configuration.',
        sourceIds: result.sourceIds,
      });
      sourceIds.push(...result.sourceIds);
    }
  }

  // ---- smoke seals
  if (profile.needsSmokeSeals) {
    const seals = input.smokeSeals ?? 'not-checked';
    const sealResult: CheckResult =
      seals === 'intact' ? 'pass' : seals === 'not-checked' ? 'no-verdict' : 'fail';
    checks.push({
      id: 'smoke-seals',
      label: 'Smoke seals',
      result: sealResult,
      statement: {
        intact: 'Seals continuous, in contact and undamaged along the head and both stiles.',
        damaged: 'Seals torn, worn flat, painted over or lifting. A seal that is not touching is not a seal.',
        missing: 'Smoke seals are not present. Without them this is not a smoke door.',
        'not-fitted': 'No smoke seals are fitted to this leaf, and this door is scheduled as a smoke door.',
        'not-checked': 'Seal condition was not recorded.',
      }[seals],
      meaning:
        'A smoke door holds smoke back through its seals. This is the check that decides whether it still does, and '
        + 'it is the one a visual walk-past always passes.',
      sourceIds: ['ncc-spec-12'],
    });
    if (sealResult === 'fail') {
      notes.push(
        'The defect library has no code for smoke seals — DOR-FD-003 is written for clearance gaps and is not the '
        + 'same finding. Raise this one with the seal condition described rather than reusing a gap code.',
      );
    }
    sourceIds.push('ncc-spec-12');
  } else if (input.smokeSeals && input.smokeSeals !== 'not-checked' && input.smokeSeals !== 'not-fitted') {
    notes.push(
      'Seals were recorded against a door typed as fire only. If the opening is a required smoke door as well, type '
      + 'it fire-and-smoke so the seals are actually assessed; if it is not, remember that a seal added to a rated '
      + 'leaf after certification is a variation from the tested specimen.',
    );
  }

  // ---- identification
  let identified: boolean | undefined;
  if (profile.hasTag) {
    if (input.tag) {
      const tag = assessTag({ ...input.tag, scheduleFrl: input.tag.scheduleFrl ?? input.scheduleFrl });
      identified = tag.identified;
      checks.push({
        id: 'tag',
        label: 'Identification tag',
        result: tag.identified ? 'pass' : 'no-verdict',
        statement: tag.statement,
        meaning:
          'A door without a readable tag may be working perfectly and still cannot be proved to be the door on the '
          + 'schedule. That is why this is never a fail — and never a pass either.',
        defectCode: tag.defectCode,
        sourceIds: tag.sourceIds,
      });
      notes.push(...tag.notes);
      sourceIds.push(...tag.sourceIds);
      if (tag.findings.includes('frl-mismatch')) {
        checks.push({
          id: 'frl-agreement',
          label: 'Tag against schedule',
          result: 'fail',
          statement: tag.frlAgreement?.statement ?? 'The FRL on the tag does not match the schedule.',
          meaning:
            'Either the register is wrong about this opening or the door has been changed. The second is a wall '
            + 'protected to less than its approval.',
          sourceIds: ['as1905-1', 'ncc-spec-1'],
        });
      }
    } else {
      checks.push({
        id: 'tag',
        label: 'Identification tag',
        result: 'no-verdict',
        statement: 'The tag was not recorded at this attendance, so this doorset has not been identified.',
        sourceIds: ['qfd-fire-doors', 'as1905-1'],
      });
      identified = false;
    }
  } else {
    checks.push({
      id: 'tag',
      label: 'Identification tag',
      result: 'not-applicable',
      statement:
        'A smoke door is not a fire-resistant doorset and carries no AS/NZS 1905.1 tag. It is identified by the '
        + 'register and by the fire safety schedule, not by a tag on the leaf.',
      sourceIds: ['ncc-spec-12'],
    });
  }

  const failedChecks = checks.filter((c) => c.result === 'fail');
  // Identification is answered by `identified`, not by the absence of a verdict.
  const checksWithoutVerdict = checks.filter((c) => c.result === 'no-verdict' && c.id !== 'tag');
  const defectCodes = [...new Set(checks.map((c) => c.defectCode).filter((c): c is string => !!c))];

  let outcome: DoorOutcome;
  let passed: boolean | undefined;
  let statement: string;
  let reason: string | undefined;

  if (failedChecks.length > 0) {
    outcome = 'fail';
    passed = false;
    statement =
      `${profile.label} failed on ${failedChecks.length === 1 ? 'one check' : `${failedChecks.length} checks`}: `
      + `${failedChecks.map((c) => c.label.toLowerCase()).join(', ')}.`;
  } else if (checksWithoutVerdict.length > 0) {
    outcome = 'unverifiable';
    statement =
      `${profile.label} passed everything that was tested, but `
      + `${checksWithoutVerdict.map((c) => c.label.toLowerCase()).join(', ')} produced no result.`;
    reason =
      'A check with no result is not a pass. Until it is done this door cannot be signed off, and the site cannot be '
      + 'called compliant on the strength of it.';
  } else if (profile.hasTag && identified !== true) {
    outcome = 'unverifiable';
    statement =
      `${profile.label} operated correctly on every check, but it could not be identified — there is no readable, `
      + 'complete tag on it.';
    reason =
      'The door works. What cannot be shown is that it is the door the schedule describes, so this is recorded as '
      + 'unverified rather than as a pass. It is a separate finding from a failed door and must be reported as one.';
  } else {
    outcome = 'pass';
    passed = true;
    identified = profile.hasTag ? true : identified;
    statement = `${profile.label} passed every check${profile.hasTag ? ' and is identified by its tag' : ''}.`;
  }

  return {
    assetId: input.assetId,
    location: input.location,
    doorType: input.doorType,
    leafAction: input.leafAction,
    outcome,
    passed,
    identified,
    checks,
    failedChecks,
    checksWithoutVerdict,
    statement,
    reason,
    defectCodes,
    notes,
    sourceIds: [...new Set(sourceIds)],
  };
}

// ---------------------------------------------------------------------------
// The site rollup
// ---------------------------------------------------------------------------

export interface SiteDoorSummary {
  total: number;
  byType: Record<DoorType, number>;
  assessed: number;
  notAssessed: number;
  passed: number;
  failed: number;
  /** Doors that worked but could not be proved to be what the schedule says. */
  unverifiable: number;
  /** Doorsets whose tag establishes what they are. Smoke doors are excluded — they have none. */
  tagged: number;
  untagged: number;
  /** Doorsets that carry a tag requirement nobody could resolve. */
  taggableDoors: number;
  failuresByCheck: { checkId: string; label: string; count: number; defectCode?: string }[];
  defectCounts: { code: string; count: number }[];
  /** Passes as a percentage of the doors assessed, to one decimal. */
  passRatePercent?: number;
  /** Passes as a percentage of the whole register, to one decimal. */
  coverageRatePercent?: number;
  /**
   * Three-valued on purpose. `undefined` means it cannot be said — which is the
   * answer whenever any door went unassessed or unidentified.
   */
  compliant?: boolean;
  compliantStatement: string;
  /** What this summary does not cover. Always populated; never optional. */
  caveats: string[];
  sourceIds: SourceId[];
}

/**
 * What may honestly be said about a site's doors.
 *
 * The compliance answer is three-valued and the middle value carries the
 * weight. `true` needs every door on the register assessed, every one passed,
 * and every fire doorset identified. `false` follows from a single failure.
 * Everything else is `undefined`, because "we did the ones we could get to and
 * they were fine" is not a compliance statement and a client will read it as
 * one.
 *
 * On a site with a thousand smoke doors this matters more than it sounds. A
 * 2 percent miss is twenty doors, and twenty unassessed doors in a residential
 * building is what "compliant" would be hiding.
 */
export function summariseDoors(verdicts: DoorVerdict[]): SiteDoorSummary {
  const byType: Record<DoorType, number> = { fire: 0, smoke: 0, 'fire-and-smoke': 0 };
  const failuresByCheck = new Map<string, { checkId: string; label: string; count: number; defectCode?: string }>();
  const defects = new Map<string, number>();

  let assessed = 0;
  let passed = 0;
  let failed = 0;
  let unverifiable = 0;
  let tagged = 0;
  let taggableDoors = 0;

  for (const v of verdicts) {
    byType[v.doorType] += 1;
    if (DOOR_TYPES[v.doorType].hasTag) {
      taggableDoors += 1;
      if (v.identified === true) tagged += 1;
    }
    if (v.outcome === 'not-assessed') continue;
    assessed += 1;
    if (v.outcome === 'pass') passed += 1;
    if (v.outcome === 'fail') failed += 1;
    if (v.outcome === 'unverifiable') unverifiable += 1;

    for (const c of v.failedChecks) {
      const row = failuresByCheck.get(c.id)
        ?? { checkId: c.id, label: c.label, count: 0, defectCode: c.defectCode };
      row.count += 1;
      failuresByCheck.set(c.id, row);
    }
    for (const code of v.defectCodes) defects.set(code, (defects.get(code) ?? 0) + 1);
  }

  const total = verdicts.length;
  const notAssessed = total - assessed;
  const untagged = taggableDoors - tagged;

  const caveats: string[] = [
    'A door assessment is what the door did on the day it was released. It says nothing about the wall the door sits '
    + 'in, the penetrations through it, or whether the opening should have a door of this rating at all.',
    'Clearances are restated from AS 1905.1—2005, which is superseded by AS 1905.1:2015.',
    'Queensland Development Code MP 6.1 sets the interval this work is done at — six-monthly in Class 5, 6, 9a and '
    + '9c buildings, yearly in all other classes — and it names clauses of AS 1851:2005, not the 2012 edition.',
  ];
  if (notAssessed > 0) {
    caveats.push(
      `${notAssessed} of ${total} doors were not assessed and are excluded from every rate above.`,
    );
  }
  if (untagged > 0) {
    caveats.push(
      `${untagged} fire doorset${untagged === 1 ? '' : 's'} could not be identified from a tag. Their ratings are `
      + 'taken from the register and have not been confirmed on site.',
    );
  }

  let compliant: boolean | undefined;
  let compliantStatement: string;
  if (total === 0) {
    compliantStatement =
      'No fire or smoke doors are recorded against this site. That is either a site with none or a register nobody '
      + 'has populated, and this app cannot tell which.';
  } else if (failed > 0) {
    compliant = false;
    compliantStatement =
      `Not compliant. ${failed} of ${total} door${total === 1 ? '' : 's'} failed, each on a check that decides `
      + 'whether the opening is protected. Every failure is a defect requiring rectification.';
  } else if (notAssessed > 0) {
    compliantStatement =
      `No compliance statement can be made. ${passed} of ${total} doors passed, but ${notAssessed} `
      + `${notAssessed === 1 ? 'was' : 'were'} not assessed and an unassessed door is not a compliant one.`;
  } else if (unverifiable > 0) {
    compliantStatement =
      `No compliance statement can be made. Every door assessed operated correctly, but ${unverifiable} of ${total} `
      + 'could not be shown to be the door the schedule describes. That is a separate finding from a failure and it '
      + 'still stops a compliance claim.';
  } else {
    compliant = true;
    compliantStatement =
      `Compliant on this attendance. All ${total} door${total === 1 ? '' : 's'} on the register were assessed, all `
      + 'passed, and every fire doorset was identified from its tag.';
  }

  return {
    total,
    byType,
    assessed,
    notAssessed,
    passed,
    failed,
    unverifiable,
    tagged,
    untagged,
    taggableDoors,
    failuresByCheck: [...failuresByCheck.values()].sort((a, b) => b.count - a.count),
    defectCounts: [...defects.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    passRatePercent: assessed > 0 ? round1((passed / assessed) * 100) : undefined,
    coverageRatePercent: total > 0 ? round1((passed / total) * 100) : undefined,
    compliant,
    compliantStatement,
    caveats,
    sourceIds: ['qdc-mp61', 'as1905-1', 'ncc-spec-12', 'qfd-fire-doors'],
  };
}
