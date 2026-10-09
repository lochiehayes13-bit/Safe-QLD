import { frequencySpec, scheduledDate, type Frequency } from '@/domain/qldCompliance';
import { parseImpreciseDate, type ImpreciseDate } from '@/parsers/assetRegister';
import { qldIsoDay } from '@/domain/qldTime';

/**
 * Portable and wheeled fire extinguishers — the largest single slice of the book.
 *
 * 5,365 of Safe QLD's 12,553 assets are extinguishers: forty-three per cent of
 * everything the company services. Until now the app carried two routines
 * against them and no logic whatsoever, which means every judgement about an
 * extinguisher has been made in a technician's head in front of a bracket and
 * written down as a tick.
 *
 * Five field failures are what this module exists to stop.
 *
 *  1. **The wrong agent on the wrong fire.** This is the only thing on the
 *     whole list that kills someone. Water on a live switchboard conducts back
 *     up the jet; CO₂ into a deep fryer blasts burning oil out of the vat; ABE
 *     powder on a Class F fire knocks the flame down and leaves the oil above
 *     its auto-ignition temperature so it relights. So suitability here is not
 *     a boolean. "Not rated" and "will hurt you" are different answers and this
 *     module never collapses them: an extinguisher that simply will not work on
 *     a fire is `unrated`, one that makes it worse is `prohibited`, and the
 *     consequence travels with the verdict.
 *  2. **One interval applied to everything.** The five-yearly is counted from
 *     the date of manufacture stamped in the cylinder, not from the last
 *     service, and the pressure test interval is not agreed between sources for
 *     carbon dioxide. Both facts are in the data, with the disagreement named.
 *  3. **A day invented out of a month.** Real registers record a pressure test
 *     as "Jun-25". Reading that as 1 June moves the next one by up to a month
 *     and the asset reports compliant while it is not. Dates are carried at the
 *     precision they were written at, and an imprecise anchor produces an
 *     imprecise due *window*, never a false-precision date.
 *  4. **Condemn or repair decided on a busy afternoon.** Some conditions put an
 *     extinguisher permanently out of service; some are a refill; and some —
 *     how deep is that pitting, is that dent structural — are a judgement no
 *     app can make from a form. Those return "undetermined", which is a
 *     different answer from "serviceable" and is never quietly rounded to it.
 *  5. **A weight check against a tolerance nobody sourced.** Weighing is how a
 *     CO₂ extinguisher is proved full, and the pass/fail hangs entirely on a
 *     tolerance figure. This app could not find that figure in any Australian
 *     publication it can reach. So it refuses to give a verdict rather than
 *     borrowing a North American one and presenting it as AS 1851.
 *
 * On sources: nothing here reproduces the text of AS 1851, AS/NZS 1841 or any
 * other standard. Clause, table and part numbers, frequencies, and figures
 * published by regulators, the industry body and manufacturers are recorded
 * with the URL they came from and a confidence, in the DATA and not in a
 * comment, so no figure can reach a report without its provenance. Where
 * sources contradict each other — and on the carbon dioxide pressure test
 * interval and on Class C they do — every reading is carried, the conservative
 * one is answered with, and the disagreement is reported rather than resolved.
 *
 * No rate, price or cost appears in this file. The site rollup answers "how
 * much work is coming" in counts of assets and activities; turning that into
 * money is the quoting module's job and the numbers are commercial terms.
 */

export type Confidence = 'high' | 'medium' | 'low';

export type SourceId =
  | 'as1851-s10'
  | 'amsa-707'
  | 'fpa-servicing'
  | 'firewize-5yr'
  | 'co2-ten-year-claim'
  | 'as1841-series'
  | 'as2444'
  | 'dcceew-halon'
  | 'qbcc-portable'
  | 'alexon-types'
  | 'essentialfire-types'
  | 'wormald-adverse';

export interface Source {
  id: SourceId;
  /** What this source is relied on for, in one line. */
  what: string;
  /** The document, and the clause, table or part within it. Numbers only, never text. */
  ref: string;
  url: string;
  confidence: Confidence;
  /**
   * Why the confidence is what it is. A Commonwealth regulator's own guidance
   * notice is not the same kind of fact as a supplier's blog post, and a
   * service report must never treat the two alike.
   */
  basis: string;
}

export const SOURCES: Record<SourceId, Source> = {
  'as1851-s10': {
    id: 'as1851-s10',
    what: 'That portable and wheeled fire extinguishers are serviced under Section 10, at six-monthly, yearly and five-yearly frequencies',
    ref: 'AS 1851-2012, Section 10',
    url: 'https://www.standards.org.au/standards-catalogue/standard-details?designation=as-1851-2012',
    confidence: 'high',
    basis:
      'The existence of the three frequencies and the section they sit under, corroborated independently by a '
      + "Commonwealth regulator's guidance notice. No clause text, table content or item wording is reproduced here; "
      + 'Safe QLD holds a purchased copy and the method is transcribed from that.',
  },
  'amsa-707': {
    id: 'amsa-707',
    what: 'The six-monthly inspection item list, that the extinguisher is weighed to establish it is fully charged, and that AS 1851 also carries a yearly and a five-yearly service',
    ref: 'AMSA Guidance Notice 707 (2/17), Attachment 1',
    url: 'https://www.amsa.gov.au/sites/default/files/2023-11/amsa707_inspection_of_portable_fire_extinguishers.pdf',
    confidence: 'high',
    basis:
      "A Commonwealth regulator's own published guidance notice, which sets out the six-monthly item list in full and "
      + 'names the yearly and five-yearly services. It is written for domestic commercial vessels, so its competency '
      + 'and record-keeping provisions are maritime and do not apply to a Queensland building.',
  },
  'fpa-servicing': {
    id: 'fpa-servicing',
    what: 'Six-monthly inspection of all extinguishers; weighing where there is no pressure gauge; emptying, pressure testing and refilling every five years; refill after any discharge; and that Queensland is the only state licensing extinguisher technicians',
    ref: 'FPA Australia Fact Sheet SFE1',
    url: 'https://www.eh.org.au/documents/item/721',
    confidence: 'medium',
    basis:
      "The industry peak body's own fact sheet, but written for building owners rather than technicians. It is used "
      + 'for the shape of the regime, not for method. Its note that there "may be other servicing requirements at 3, 5 '
      + 'or 6 years" is exactly the kind of vagueness this module refuses to turn into an interval.',
  },
  'firewize-5yr': {
    id: 'firewize-5yr',
    what: 'That the five-yearly falls on the anniversary of the date of manufacture stamped on the cylinder, and that the pressure test is at the greater of 1.5 times working pressure or 2 MPa',
    ref: 'Firewize, extinguisher date stamps (AS 1851 Table 10.4.3)',
    url: 'https://firewize.com.au/learn/what-date-stamp-portable-fire-extinguishers',
    confidence: 'low',
    basis:
      "An Australian fire contractor's own technical page. Second-hand: the table and item numbering was not read from "
      + 'the standard by this app. The anchor rule it states — count from manufacture, not from the last service — is '
      + 'corroborated by how the industry date-stamps cylinders, which is why it is relied on at all.',
  },
  'co2-ten-year-claim': {
    id: 'co2-ten-year-claim',
    what: 'The competing claim that carbon dioxide extinguishers are pressure tested at ten years while every other portable is tested at five',
    ref: 'Firechief, extinguisher pressure testing guide',
    url: 'https://firechief.net.au/fire-extinguisher-pressure-testing-adelaide-guide/',
    confidence: 'low',
    basis:
      "An Australian fire contractor's own page, and the only source reached that states the ten-year figure in its "
      + 'own words. It names AS 1851 as the governing standard but does not say which clause or table the ten years '
      + 'comes from, and it is not reconcilable with the sources that put every portable extinguisher on a five-yearly '
      + 'test. No standard designation is asserted for it here, because none of the sources reached gives one. Carried '
      + 'because the disagreement is real and a technician needs to know it exists, not because this app believes it.',
  },
  'as1841-series': {
    id: 'as1841-series',
    what: 'Which part of the AS/NZS 1841 series specifies each extinguisher type, and that the date of manufacture is a required marking',
    ref: 'AS/NZS 1841 series',
    url: 'https://www.standards.org.au/standards-catalogue/standard-details?designation=as-nzs-1841-1-2007',
    confidence: 'medium',
    basis:
      'Part numbering taken from standards catalogue listings rather than from the standards themselves. The mapping '
      + 'of parts 6 and 7 to carbon dioxide and vaporising liquid is the one most likely to be the wrong way round in '
      + 'these listings; confirm against the purchased set before printing a part number on a document.',
  },
  as2444: {
    id: 'as2444',
    what: 'That extinguisher location signage and selection/placement is governed by its own standard, which the six-monthly inspection checks against',
    ref: 'AS 2444 Selection and location',
    url: 'https://www.standards.org.au/standards-catalogue/standard-details?designation=as-2444-2001',
    confidence: 'medium',
    basis:
      'Named as the signage reference by the AMSA six-monthly item list. Cited here for scope only — nothing in this '
      + 'module decides placement, which is a design question and not a service one.',
  },
  'dcceew-halon': {
    id: 'dcceew-halon',
    what: 'That halon extinguishers may not be owned or used in Australia without an approved essential use, that surrendered halon goes to the National Halon Bank, and that disposal has been free of charge since 1 January 2023',
    ref: 'DCCEEW, halon disposal',
    url: 'https://www.dcceew.gov.au/environment/protection/ozone/halon/halon-disposal',
    confidence: 'high',
    basis:
      "The Commonwealth department's own page on its own scheme. This is the one condemnation in this module that is "
      + 'a legal obligation rather than a technical judgement, which is why it outranks every other finding.',
  },
  'qbcc-portable': {
    id: 'qbcc-portable',
    what: 'That Queensland licenses portable fire equipment work by class, and that a certify licence does not authorise inspect-and-test work',
    ref: 'QBCC, fire protection (portable) licence',
    url: 'https://qbcc.qld.gov.au/licences/apply-licence/available-licences/fire-protection/fire-protection-portable-certify',
    confidence: 'high',
    basis:
      "The Queensland regulator's own page for the licence class, which is where the exclusion is actually stated: "
      + 'inspect and test work is outside the certify scope and needs the inspect-and-test class for the stream. The '
      + 'licence-framework overview page names the classes but does not state that exclusion, so the class page is '
      + 'cited instead of it. Relevant to every line of this module because in Queensland the person '
      + 'signing the record has to hold the class for the work actually done, and the record of maintenance carries '
      + 'their licence number.',
  },
  'alexon-types': {
    id: 'alexon-types',
    what: 'Colour bands and the fire classes each Australian extinguisher type is sold against',
    ref: 'Alexon, extinguisher types and colour bands',
    url: 'https://www.alexon.com.au/news/fire-extinguisher-types-a-complete-guide-to-classes-and-colour-bands',
    confidence: 'low',
    basis:
      "A supplier's own guide. Agrees with the other trade source on every band and on every prohibition that matters, "
      + 'and disagrees with it on whether ABE powder carries a Class C rating. Both readings are carried.',
  },
  'essentialfire-types': {
    id: 'essentialfire-types',
    what: 'Colour bands and fire classes, including BE powder and the class-by-class prohibitions',
    ref: 'Essential Fire Services, extinguisher types',
    url: 'https://www.essentialfire.net.au/extinguisher-types',
    confidence: 'low',
    basis:
      "A contractor's own guide, and the only source reached that covers BE powder separately from ABE. Second-hand "
      + 'throughout. The prohibitions it lists match the physics and match the other trade source, which is why they '
      + 'are treated as reliable while its Class C rating claim is not.',
  },
  'wormald-adverse': {
    id: 'wormald-adverse',
    what: 'That AS 1851-2012 sets a separate regime for equipment in adverse or aggressive environments, at clause 1.13',
    ref: 'Wormald, adverse environments (AS 1851 Clause 1.13)',
    url: 'https://wormald.com.au/blog/understanding-adverse-environments/',
    confidence: 'low',
    basis:
      "A manufacturer's blog. Relied on only for the existence of the clause and the fact that servicing frequency "
      + 'increases in an adverse environment. By how much it increases is not established here, and this module will '
      + 'not shorten an interval on the strength of it.',
  },
};

/** Every source behind a result, in the order a report should list them, without repeats. */
export function citeSources(ids: SourceId[]): Source[] {
  const seen = new Set<SourceId>();
  const out: Source[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const s = SOURCES[id];
    if (s) out.push(s);
  }
  return out;
}

/**
 * Why a refusal happened, in a form a caller can count.
 *
 * The prose in `reason` is written for a technician and will be reworded; the
 * code is written for the rollup and must not be. Counting refusals by pattern
 * matching their sentences — which the site rollup used to do — means an editor
 * improving a message silently drops a caveat off a proposal, and nothing
 * fails.
 */
export type RefusalCode =
  | 'type-cell-empty'
  | 'type-cell-ambiguous-powder'
  | 'type-cell-two-agents'
  | 'type-cell-unrecognised'
  | 'no-anchor-date'
  | 'manufacture-in-future'
  | 'service-before-manufacture'
  | 'service-in-future'
  | 'anchor-unusable'
  | 'interval-mismatch'
  | 'mass-not-read'
  | 'mass-not-whole-grams'
  | 'gross-at-or-below-tare'
  | 'no-expected-charge'
  | 'no-charge-tolerance'
  | 'tolerance-not-a-percentage'
  | 'no-position-held';

/**
 * The answer where there is no answer.
 *
 * Same shape the emergency lighting module uses, and deliberately so: a refusal
 * always says what it could not decide and what a person has to do to get a
 * decision. A refusal with no `whatToDo` is a dead end on site.
 */
export interface Refused {
  known: false;
  code: RefusalCode;
  reason: string;
  whatToDo: string;
  sourceIds: SourceId[];
}

export function isRefused(v: unknown): v is Refused {
  return !!v && typeof v === 'object' && (v as Refused).known === false;
}

// ===========================================================================
// Fire classes
// ===========================================================================

/**
 * The Australian classes. Note E, not C, for electrical.
 *
 * Anyone who has read American material has "Class C" filed under electrical,
 * and in Australia Class C is flammable gas while electrical is Class E. A
 * technician working from the wrong list will happily put a water extinguisher
 * in front of a switchboard.
 */
export type FireClass = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export const FIRE_CLASS_LABEL: Record<FireClass, string> = {
  A: 'Class A: ordinary combustibles',
  B: 'Class B: flammable and combustible liquids',
  C: 'Class C: flammable gases',
  D: 'Class D: combustible metals',
  E: 'Class E: electrically energised equipment',
  F: 'Class F: cooking oils and fats',
};

export const FIRE_CLASS_EXAMPLES: Record<FireClass, string> = {
  A: 'Timber, paper, cardboard, textiles, most plastics.',
  B: 'Petrol, diesel, solvents, paints, oils that are not cooking oils.',
  C: 'LPG, natural gas, acetylene: a leak alight where it escapes.',
  D: 'Magnesium, sodium, lithium, titanium, and swarf of the same.',
  E: 'Switchboards, motors, appliances and cabling while still energised. De-energise and it becomes whatever it is made of.',
  F: 'Deep fryers, woks, griddles: cooking oils and fats at cooking temperature.',
};

// ===========================================================================
// The types, and what each must never be used on
// ===========================================================================

export type ExtinguisherType =
  | 'water'
  | 'foam'
  | 'dry-chemical-abe'
  | 'dry-chemical-be'
  | 'carbon-dioxide'
  | 'wet-chemical'
  | 'vaporising-liquid'
  | 'halon';

/**
 * Four values, because two would be a safety failure.
 *
 * `unrated` and `prohibited` are the pair that matters. A CO₂ extinguisher on a
 * paper fire is `unrated` — it will knock the flame down, fail to cool
 * anything, and the fire will come back; nobody is hurt. A CO₂ extinguisher in
 * a fryer is `prohibited` — the discharge throws burning oil across the
 * kitchen. A service sheet that prints "no" against both has told the reader
 * nothing about which one will injure them.
 */
export type Suitability = 'rated' | 'conditional' | 'unrated' | 'prohibited';

export const SUITABILITY_LABEL: Record<Suitability, string> = {
  rated: 'Rated',
  conditional: 'Only in stated circumstances',
  unrated: 'Not rated: will not put it out',
  prohibited: 'MUST NOT be used',
};

export interface ClassSuitability {
  fireClass: FireClass;
  suitability: Suitability;
  /**
   * What actually happens. Required on `prohibited` and `conditional`, because
   * a prohibition without a consequence gets argued with on site.
   */
  consequence?: string;
  confidence: Confidence;
  sourceIds: SourceId[];
  /** Set where the sources this app reached do not agree about this class. */
  dispute?: string;
}

export interface ExtinguisherProfile {
  type: ExtinguisherType;
  label: string;
  /** Short form as it appears on a register or a tag. */
  shortLabel: string;
  agent: string;
  /** The AS/NZS 1841 part that specifies the type, where the mapping is known. */
  standardPart?: string;
  /**
   * The band over the signal red body. Water is the odd one out — it is plain
   * red with no band, which is why a plain red cylinder is never "unlabelled".
   */
  colourBand: string;
  /**
   * Whether the body carries a pressure gauge. `false` for carbon dioxide,
   * which is why CO₂ is the type that must be weighed. `null` where it depends
   * on the model and the technician has to look.
   */
  hasPressureGauge: boolean | null;
  classes: ClassSuitability[];
  /** Hazards of the extinguisher itself, whatever it is pointed at. */
  handlingCautions: string[];
  /** Set on an agent that may no longer be kept in service in Australia. */
  withdrawn?: { statement: string; sourceIds: SourceId[] };
  sourceIds: SourceId[];
}

/** Every class not listed against a type is `unrated` by omission — this makes that explicit. */
const ALL_CLASSES: FireClass[] = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * The Class C position, which is the same for every agent and is not a rating.
 *
 * A burning gas escape put out without isolating the supply leaves gas filling
 * the room with an ignition source still in it. The correct action is to shut
 * the valve and let it burn out. That is a decision about the installation, not
 * about the extinguisher, so every type carries the same conditional entry
 * rather than a yes or a no — and the disagreement between the two trade
 * sources about whether ABE carries a Class C rating is recorded on it.
 */
const CLASS_C_CONDITIONAL: Omit<ClassSuitability, 'sourceIds'> = {
  fireClass: 'C',
  suitability: 'conditional',
  consequence:
    'Isolate the gas first. Put out with gas still flowing, it fills the space with an explosive mix; isolate, then '
    + 'deal with what is alight. This is about the valve, not a rating: check the label.',
  confidence: 'medium',
  dispute: 'Trade sources differ on whether ABE carries a Class C rating. Either way, isolate the gas.',
};

/**
 * Class D, which every agent in this list is prohibited on rather than merely
 * unrated. Named for what it returns: water and carbon dioxide are not useless
 * on burning metal, they are fuel for it.
 */
const CLASS_D_PROHIBITED = (sourceIds: SourceId[]): ClassSuitability => ({
  fireClass: 'D',
  suitability: 'prohibited',
  consequence:
    'Burning metal reacts with water and CO₂ and feeds on both. Class D needs a purpose-made metal-fire agent; nothing '
    + 'in this list will do it.',
  confidence: 'medium',
  sourceIds,
});

export const PROFILES: Record<ExtinguisherType, ExtinguisherProfile> = {
  water: {
    type: 'water',
    label: 'Water',
    shortLabel: 'Water',
    agent: 'Water, usually 9 L, stored pressure',
    standardPart: 'AS/NZS 1841.2',
    colourBand: 'Plain signal red, no band — the absence of a band is the identification',
    hasPressureGauge: true,
    classes: [
      { fireClass: 'A', suitability: 'rated', confidence: 'high', sourceIds: ['alexon-types', 'essentialfire-types'] },
      {
        fireClass: 'B',
        suitability: 'prohibited',
        consequence:
          'Water sinks under a burning liquid, flashes to steam and throws the fuel out of the container. The fire '
          + 'goes with it.',
        confidence: 'high',
        sourceIds: ['alexon-types', 'essentialfire-types'],
      },
      { ...CLASS_C_CONDITIONAL, sourceIds: ['essentialfire-types'] },
      CLASS_D_PROHIBITED(['essentialfire-types']),
      {
        fireClass: 'E',
        suitability: 'prohibited',
        consequence:
          'The jet is a conductor and the operator is holding the other end. A plain red cylinder by a switchboard is '
          + 'how people get killed.',
        confidence: 'high',
        sourceIds: ['alexon-types', 'essentialfire-types'],
      },
      {
        fireClass: 'F',
        suitability: 'prohibited',
        consequence:
          'Cooking oil is far above the boiling point of water. The water flashes to steam under the surface and '
          + 'ejects burning oil as a fireball.',
        confidence: 'high',
        sourceIds: ['alexon-types', 'essentialfire-types'],
      },
    ],
    handlingCautions: [
      'Plain red with no band is a water extinguisher, not a missing band. Keep it away from electrical equipment.',
    ],
    sourceIds: ['as1841-series', 'alexon-types', 'essentialfire-types'],
  },

  foam: {
    type: 'foam',
    label: 'Foam (AFFF)',
    shortLabel: 'Foam',
    agent: 'Aqueous film-forming foam concentrate in water, usually 9 L',
    standardPart: 'AS/NZS 1841.4',
    colourBand: 'Blue band',
    hasPressureGauge: true,
    classes: [
      { fireClass: 'A', suitability: 'rated', confidence: 'high', sourceIds: ['alexon-types', 'essentialfire-types'] },
      { fireClass: 'B', suitability: 'rated', confidence: 'high', sourceIds: ['alexon-types', 'essentialfire-types'] },
      { ...CLASS_C_CONDITIONAL, sourceIds: ['essentialfire-types'] },
      CLASS_D_PROHIBITED(['essentialfire-types']),
      {
        fireClass: 'E',
        suitability: 'prohibited',
        consequence:
          'Foam is mostly water and conducts. Being rated for flammable liquids does not make it safe near an '
          + 'energised motor or board, and that is exactly where the two risks sit together in a plant room.',
        confidence: 'high',
        sourceIds: ['alexon-types', 'essentialfire-types'],
      },
      {
        fireClass: 'F',
        suitability: 'prohibited',
        consequence:
          'Same as water: it flashes to steam under the oil and throws it out. Cooking oil takes wet chemical, not foam.',
        confidence: 'high',
        sourceIds: ['alexon-types', 'essentialfire-types'],
      },
    ],
    handlingCautions: [
      'Foam concentrates are changing as fluorinated foams are phased out. Check what it holds before refilling, and '
      + 'whether the site has a PFAS management plan.',
    ],
    sourceIds: ['as1841-series', 'alexon-types', 'essentialfire-types'],
  },

  'dry-chemical-abe': {
    type: 'dry-chemical-abe',
    label: 'Dry chemical powder (ABE)',
    shortLabel: 'ABE',
    agent: 'Monoammonium phosphate based dry chemical powder',
    standardPart: 'AS/NZS 1841.5',
    colourBand: 'White band',
    hasPressureGauge: true,
    classes: [
      { fireClass: 'A', suitability: 'rated', confidence: 'high', sourceIds: ['alexon-types', 'essentialfire-types'] },
      { fireClass: 'B', suitability: 'rated', confidence: 'high', sourceIds: ['alexon-types', 'essentialfire-types'] },
      { ...CLASS_C_CONDITIONAL, sourceIds: ['alexon-types', 'essentialfire-types'] },
      CLASS_D_PROHIBITED(['essentialfire-types']),
      { fireClass: 'E', suitability: 'rated', confidence: 'high', sourceIds: ['alexon-types', 'essentialfire-types'] },
      {
        fireClass: 'F',
        suitability: 'prohibited',
        consequence:
          'Splashes burning oil out of the vat and does not cool it, so it relights, often after the operator walks '
          + 'away. The commonest wrong-extinguisher finding in a kitchen.',
        confidence: 'high',
        sourceIds: ['alexon-types', 'essentialfire-types'],
      },
    ],
    handlingCautions: [
      'Discharged indoors it kills visibility in seconds. In a small plant room the way out can be lost.',
      'Mildly corrosive and gets everywhere. Over a switchboard or server rack it can cost more than the fire; use '
      + 'CO₂ there.',
      'Invert and shake at the six-monthly. Packed powder will not discharge whatever the gauge says.',
    ],
    sourceIds: ['as1841-series', 'alexon-types', 'essentialfire-types'],
  },

  'dry-chemical-be': {
    type: 'dry-chemical-be',
    label: 'Dry chemical powder (BE)',
    shortLabel: 'BE',
    agent: 'Sodium bicarbonate based dry chemical powder',
    standardPart: 'AS/NZS 1841.5',
    colourBand: 'White band — the same band as ABE, so the band alone does not tell you which it is',
    hasPressureGauge: true,
    classes: [
      {
        fireClass: 'A',
        suitability: 'unrated',
        consequence:
          'No Class A rating. It knocks flame down but does not crust over, so a deep-seated fire comes back. It looks '
          + 'the same as ABE: both carry a white band.',
        confidence: 'medium',
        sourceIds: ['essentialfire-types'],
      },
      { fireClass: 'B', suitability: 'rated', confidence: 'medium', sourceIds: ['essentialfire-types'] },
      { ...CLASS_C_CONDITIONAL, sourceIds: ['essentialfire-types'] },
      CLASS_D_PROHIBITED(['essentialfire-types']),
      { fireClass: 'E', suitability: 'rated', confidence: 'medium', sourceIds: ['essentialfire-types'] },
      {
        fireClass: 'F',
        suitability: 'prohibited',
        consequence: 'Treat as prohibited on Class F: it splashes like ABE and does not cool. Use wet chemical.',
        confidence: 'low',
        sourceIds: ['essentialfire-types'],
        dispute: 'Some overseas guidance rates bicarbonate powder for cooking oil. No Australian source does.',
      },
    ],
    handlingCautions: [
      'ABE and BE share a white band. If the register or tag does not say which, read the label.',
      'Same visibility and residue problems as ABE.',
    ],
    sourceIds: ['as1841-series', 'essentialfire-types'],
  },

  'carbon-dioxide': {
    type: 'carbon-dioxide',
    label: 'Carbon dioxide',
    shortLabel: 'CO₂',
    agent: 'Liquefied carbon dioxide under its own vapour pressure',
    standardPart: 'AS/NZS 1841.6',
    colourBand: 'Black band',
    hasPressureGauge: false,
    classes: [
      {
        fireClass: 'A',
        suitability: 'unrated',
        consequence:
          'Smothers but does not cool. Paper or timber reignites once the gas disperses, almost at once outdoors or in '
          + 'a draught.',
        confidence: 'high',
        sourceIds: ['alexon-types', 'essentialfire-types'],
      },
      { fireClass: 'B', suitability: 'rated', confidence: 'high', sourceIds: ['alexon-types', 'essentialfire-types'] },
      { ...CLASS_C_CONDITIONAL, sourceIds: ['essentialfire-types'] },
      CLASS_D_PROHIBITED(['essentialfire-types']),
      {
        fireClass: 'E',
        suitability: 'rated',
        consequence: 'Non-conductive and leaves no residue: the one for switchrooms, comms rooms and labs.',
        confidence: 'high',
        sourceIds: ['alexon-types', 'essentialfire-types'],
      },
      {
        fireClass: 'F',
        suitability: 'prohibited',
        consequence: 'Blows burning oil out of the vat and does not cool it. A CO₂ unit in a kitchen is a defect to raise.',
        confidence: 'high',
        sourceIds: ['alexon-types', 'essentialfire-types'],
      },
    ],
    handlingCautions: [
      'No pressure gauge. Only weighing proves it full.',
      'The horn gets cryogenically cold in use. Hold the handle, not the horn.',
      'In a small closed room it displaces the air. Get out with it.',
      'High-pressure cylinder. Body, thread or corrosion damage is more serious than on a stored-pressure unit.',
    ],
    sourceIds: ['as1841-series', 'alexon-types', 'essentialfire-types'],
  },

  'wet-chemical': {
    type: 'wet-chemical',
    label: 'Wet chemical',
    shortLabel: 'Wet chem',
    agent: 'Potassium salt solution, applied as a fine spray',
    standardPart: 'AS/NZS 1841.3',
    colourBand: 'Oatmeal band',
    hasPressureGauge: true,
    classes: [
      {
        fireClass: 'A',
        suitability: 'rated',
        confidence: 'medium',
        sourceIds: ['alexon-types'],
        dispute: 'Trade sources differ on a Class A rating. Go by the label.',
      },
      {
        fireClass: 'B',
        suitability: 'unrated',
        consequence: 'Rated for cooking oils, not flammable liquids generally. A kitchen unit does not cover the solvent store.',
        confidence: 'medium',
        sourceIds: ['essentialfire-types'],
      },
      { ...CLASS_C_CONDITIONAL, sourceIds: ['essentialfire-types'] },
      CLASS_D_PROHIBITED(['essentialfire-types']),
      {
        fireClass: 'E',
        suitability: 'prohibited',
        consequence:
          'A salt solution: it conducts. Fryer, griddle and their power are within arm’s reach, so isolate before use.',
        confidence: 'high',
        sourceIds: ['alexon-types', 'essentialfire-types'],
      },
      {
        fireClass: 'F',
        suitability: 'rated',
        consequence: 'The only agent here rated for cooking oils. It forms a soap layer and cools the oil; apply it slowly.',
        confidence: 'high',
        sourceIds: ['alexon-types', 'essentialfire-types'],
      },
    ],
    handlingCautions: [
      'A slow spray, not a jet. Rushed, it splashes the oil it should be blanketing.',
      'A Class F risk with no wet chemical unit is a selection defect.',
    ],
    sourceIds: ['as1841-series', 'alexon-types', 'essentialfire-types'],
  },

  'vaporising-liquid': {
    type: 'vaporising-liquid',
    label: 'Vaporising liquid',
    shortLabel: 'Vap liquid',
    agent: 'Clean agent halocarbon, non-conductive, leaves no residue',
    standardPart: 'AS/NZS 1841.7',
    colourBand: 'Yellow band',
    hasPressureGauge: true,
    classes: [
      {
        fireClass: 'A',
        suitability: 'rated',
        confidence: 'low',
        sourceIds: ['as1841-series'],
        dispute: 'General clean-agent ratings. Use the rating on the label.',
      },
      { fireClass: 'B', suitability: 'rated', confidence: 'low', sourceIds: ['as1841-series'] },
      { ...CLASS_C_CONDITIONAL, sourceIds: ['as1841-series'] },
      CLASS_D_PROHIBITED(['as1841-series']),
      { fireClass: 'E', suitability: 'rated', confidence: 'low', sourceIds: ['as1841-series'] },
      {
        fireClass: 'F',
        suitability: 'prohibited',
        consequence: 'A gas does not cool oil above its auto-ignition temperature. Like CO₂, it goes out and comes back.',
        confidence: 'medium',
        sourceIds: ['as1841-series'],
      },
    ],
    handlingCautions: [
      'Clean agents differ. Read the label, not the band, and record the agent name: a refill has to match.',
      'Not halon. If the label says BCF, halon 1211 or halon 1301, classify it as halon and stop.',
    ],
    sourceIds: ['as1841-series'],
  },

  halon: {
    type: 'halon',
    label: 'Halon (BCF), withdrawn',
    shortLabel: 'Halon',
    agent: 'Halon 1211 (BCF) or halon 1301, an ozone depleting substance',
    colourBand: 'Yellow band on older units. Do not rely on the band: read the label.',
    hasPressureGauge: null,
    classes: [
      { fireClass: 'A', suitability: 'unrated', confidence: 'low', sourceIds: ['dcceew-halon'] },
      { fireClass: 'B', suitability: 'unrated', confidence: 'low', sourceIds: ['dcceew-halon'] },
      { ...CLASS_C_CONDITIONAL, sourceIds: ['dcceew-halon'] },
      CLASS_D_PROHIBITED(['dcceew-halon']),
      { fireClass: 'E', suitability: 'unrated', confidence: 'low', sourceIds: ['dcceew-halon'] },
      {
        fireClass: 'F',
        suitability: 'prohibited',
        consequence: 'A gaseous agent does not cool cooking oil, and this one may not lawfully be discharged at all.',
        confidence: 'medium',
        sourceIds: ['dcceew-halon'],
      },
    ],
    handlingCautions: [
      'Do not test-discharge and do not refill. Discharging halon is releasing an ozone depleting substance.',
      'It still turns up: old switchrooms, marine survey kit, aviation ground equipment, and boxes in plant rooms '
      + 'nobody has opened since the nineties.',
    ],
    withdrawn: {
      statement:
        'Not lawful to own or use in Australia since 1995 outside an approved essential use. Surrender it to the '
        + 'National Halon Bank (free since 1 January 2023); do not service or scrap it. Tell the owner in writing.',
      sourceIds: ['dcceew-halon'],
    },
    sourceIds: ['dcceew-halon'],
  },
};

export const ALL_TYPES: ExtinguisherType[] = Object.keys(PROFILES) as ExtinguisherType[];

export function profileFor(type: ExtinguisherType): ExtinguisherProfile {
  return PROFILES[type];
}

/**
 * What this type may be used on, for one class.
 *
 * Returns undefined rather than a default where a class is not listed. Every
 * profile lists all six, so undefined means the data is incomplete and the
 * caller must say "not established" rather than "not suitable" — which are, yet
 * again, different statements.
 */
export function suitabilityFor(type: ExtinguisherType, fireClass: FireClass): ClassSuitability | undefined {
  return PROFILES[type].classes.find((c) => c.fireClass === fireClass);
}

export function ratedClasses(type: ExtinguisherType): FireClass[] {
  return PROFILES[type].classes.filter((c) => c.suitability === 'rated').map((c) => c.fireClass);
}

export function prohibitedClasses(type: ExtinguisherType): FireClass[] {
  return PROFILES[type].classes.filter((c) => c.suitability === 'prohibited').map((c) => c.fireClass);
}

/**
 * The one line that goes on a service sheet under the extinguisher's type.
 *
 * Built from the data so it can never drift from the class table above it, and
 * phrased as a prohibition rather than as a rating because the rating is on the
 * label already and the prohibition is not.
 */
export function prohibitionLine(type: ExtinguisherType): string {
  const banned = prohibitedClasses(type);
  if (!banned.length) return 'No class in this list is prohibited for this type.';
  return `MUST NOT be used on ${banned.map((c) => `Class ${c}`).join(', ')}.`;
}

export interface UseVerdict {
  type: ExtinguisherType;
  fireClass: FireClass;
  suitability: Suitability;
  statement: string;
  consequence?: string;
  dispute?: string;
  confidence: Confidence;
  sourceIds: SourceId[];
}

/**
 * Whether this extinguisher may be used on this fire.
 *
 * Written to be readable out loud in front of a client, because that is what a
 * technician does with it when asked why the kitchen unit has to change.
 */
export function checkUse(type: ExtinguisherType, fireClass: FireClass): UseVerdict | Refused {
  const profile = PROFILES[type];
  const entry = suitabilityFor(type, fireClass);
  if (!entry) {
    return {
      known: false,
      code: 'no-position-held',
      reason: `No rating held for ${profile.label} on ${FIRE_CLASS_LABEL[fireClass]}.`,
      whatToDo: "Read the rating printed on the extinguisher's own label and record it against the asset.",
      sourceIds: profile.sourceIds,
    };
  }

  const statement =
    entry.suitability === 'prohibited'
      ? `${profile.label} MUST NOT be used on ${FIRE_CLASS_LABEL[fireClass]}.`
      : entry.suitability === 'rated'
        ? `${profile.label} is rated for ${FIRE_CLASS_LABEL[fireClass]}.`
        : entry.suitability === 'conditional'
          ? `${profile.label} may be used on ${FIRE_CLASS_LABEL[fireClass]} only in the circumstances stated.`
          : `${profile.label} is not rated for ${FIRE_CLASS_LABEL[fireClass]}. It is not dangerous here; it will not put the fire out.`;

  return {
    type,
    fireClass,
    suitability: entry.suitability,
    statement,
    consequence: entry.consequence,
    dispute: entry.dispute,
    confidence: entry.confidence,
    sourceIds: entry.sourceIds,
  };
}

/** Which types are rated for a class — the "what should be on this wall" question. */
export function typesForClass(fireClass: FireClass): ExtinguisherType[] {
  return ALL_TYPES.filter(
    (t) => !PROFILES[t].withdrawn && suitabilityFor(t, fireClass)?.suitability === 'rated',
  );
}

// ===========================================================================
// Reading the type off a register cell
// ===========================================================================

export interface TypeMatch {
  type: ExtinguisherType;
  /** The substring that decided it, so a doubtful match can be eyeballed. */
  matched: string;
  confidence: Confidence;
}

/**
 * Patterns in the order they must be tried.
 *
 * Order is load-bearing twice over. "Wet chemical" has to be caught before
 * anything looks for "chem", and ABE/BE have to be caught before a bare
 * "powder" or "DCP" is considered — because a bare "powder" is ambiguous and
 * this function refuses it rather than picking the commoner one.
 */
const TYPE_PATTERNS: { type: ExtinguisherType; re: RegExp; confidence: Confidence }[] = [
  { type: 'halon', re: /\bhalon\b|\bbcf\b|\b1211\b|\b1301\b/i, confidence: 'high' },
  { type: 'wet-chemical', re: /wet\s*-?\s*chem\w*/i, confidence: 'high' },
  { type: 'carbon-dioxide', re: /\bco\s*-?\s*2\b|\bco₂|carbon\s*di-?\s*oxide/i, confidence: 'high' },
  { type: 'dry-chemical-abe', re: /\babe\b/i, confidence: 'high' },
  // The one pattern in this list that is deliberately case sensitive. "BE" is
  // an agent designation and is written in capitals wherever it means one;
  // "be" is the commonest word in English, and a case-insensitive match turns
  // a note cell reading "9kg to be replaced" into a BE powder unit — a type
  // with no Class A rating, asserted onto an asset nobody has looked at. A
  // lower-case "be" falls through to the powder refusal or to "not
  // recognised", which are both answers a person can act on.
  { type: 'dry-chemical-be', re: /(?:^|[^A-Za-z])BE(?![A-Za-z])/, confidence: 'medium' },
  { type: 'foam', re: /\bafff\b|\bfoam\b|\bff\b/i, confidence: 'high' },
  { type: 'vaporising-liquid', re: /vapou?ri[sz]ing|\bhalotron\b|\bfe-?36\b|\bfm-?200\b|clean\s*agent/i, confidence: 'medium' },
  { type: 'water', re: /\bwater\b|\bh2o\b|\bair\s*water\b/i, confidence: 'high' },
];

/** Descriptors that name a powder without saying which powder. */
const AMBIGUOUS_POWDER = /\bdcp\b|\bdry\s*(chem\w*|powder)\b|\bpowder\b/i;

/**
 * Which type a register descriptor names.
 *
 * The register's "Extinguisher Type" column is free text typed by technicians
 * over many years, and the value of this function is entirely in what it
 * refuses. "9.0kg DCP" is not enough: ABE and BE wear the same white band and
 * differ on Class A and on how they are selected, so guessing ABE because it is
 * commoner puts a Class A rating on an asset that may not have one. Likewise a
 * cell naming two agents is a trolley, a typo, or two assets on one row, and
 * none of those is safely resolved here.
 */
export function classifyTypeText(text: string | undefined): TypeMatch | Refused {
  const raw = (text ?? '').trim();
  if (!raw) {
    return {
      known: false,
      code: 'type-cell-empty',
      reason: 'The type column is empty.',
      whatToDo: 'Read the type off the label at the next attendance and correct the register.',
      sourceIds: ['as1841-series'],
    };
  }

  const hits: TypeMatch[] = [];
  for (const p of TYPE_PATTERNS) {
    const m = raw.match(p.re);
    if (m) hits.push({ type: p.type, matched: m[0], confidence: p.confidence });
  }

  // ABE contains no "BE" word boundary, but "ABE/BE" and "BE (ABE)" do produce
  // both. A row naming both powders is ambiguous like any other double match.
  const distinct = [...new Set(hits.map((h) => h.type))];

  if (distinct.length > 1) {
    return {
      known: false,
      code: 'type-cell-two-agents',
      reason: `"${raw}" names more than one agent: ${distinct.map((t) => PROFILES[t].shortLabel).join(' and ')}.`,
      whatToDo: 'One row per extinguisher. Read the label and record the one agent it holds.',
      sourceIds: ['as1841-series'],
    };
  }

  if (distinct.length === 1) return hits.find((h) => h.type === distinct[0])!;

  if (AMBIGUOUS_POWDER.test(raw)) {
    return {
      known: false,
      code: 'type-cell-ambiguous-powder',
      reason: `"${raw}" says powder but not ABE or BE. They share a white band and differ on Class A.`,
      whatToDo: 'Read the label. Until then treat it as unclassified, not as ABE.',
      sourceIds: ['essentialfire-types'],
    };
  }

  return {
    known: false,
    code: 'type-cell-unrecognised',
    reason: `"${raw}" is not a known extinguisher type.`,
    whatToDo: 'Read the label and record the agent. Do not assume from the size or the location.',
    sourceIds: ['as1841-series'],
  };
}

// ===========================================================================
// Maintenance intervals
// ===========================================================================

/**
 * The three routine service frequencies for extinguishers.
 *
 * Named to match the compliance vocabulary in qldCompliance rather than the way
 * technicians say them, so the schedule arithmetic is literally the same code
 * the rest of the app uses.
 */
export type ServiceActivity = 'six-monthly' | 'yearly' | 'five-yearly';

export const ACTIVITY_LABEL: Record<ServiceActivity, string> = {
  'six-monthly': 'Six-monthly inspection',
  yearly: 'Yearly service',
  'five-yearly': 'Five-yearly service and pressure test',
};

/** Every activity maps onto a Section 6 frequency of the same length. */
const ACTIVITY_FREQUENCY: Record<ServiceActivity, Frequency> = {
  'six-monthly': 'six-monthly',
  yearly: 'yearly',
  'five-yearly': 'five-yearly',
};

export interface IntervalSpec {
  activity: ServiceActivity;
  intervalMonths: number;
  label: string;
  /** What the activity covers, in Safe QLD's own words. Never the standard's. */
  what: string[];
  confidence: Confidence;
  sourceIds: SourceId[];
  /** Set where the sources disagree about this interval for this type. */
  dispute?: string;
}

const SIX_MONTHLY_ITEMS = [
  'Conspicuous, accessible, in its assigned location and on its bracket.',
  'Anti-tamper device intact, maintenance record tag attached and legible.',
  'Body, hose and horn undamaged, uncorroded and unobstructed; operating instructions readable.',
  'Pressure indicator reading in the operable band, where one is fitted.',
  'Weighed to confirm full charge; the only check on a unit with no gauge.',
  'Location sign visible.',
  'Powder units inverted to confirm the powder is still free-flowing.',
];

/**
 * The intervals, by type.
 *
 * They are the same six-monthly and yearly for every type. The five-yearly is
 * where the type matters, and where the sources fall out with each other over
 * carbon dioxide. See pressureTestInterval below.
 */
export function intervalsFor(type: ExtinguisherType): IntervalSpec[] {
  const pressure = pressureTestInterval(type);
  return [
    {
      activity: 'six-monthly',
      intervalMonths: 6,
      label: ACTIVITY_LABEL['six-monthly'],
      what: SIX_MONTHLY_ITEMS,
      confidence: 'high',
      sourceIds: ['as1851-s10', 'amsa-707', 'fpa-servicing', 'as2444'],
    },
    {
      activity: 'yearly',
      intervalMonths: 12,
      label: ACTIVITY_LABEL.yearly,
      what: [
        'The six-monthly inspection, plus the yearly items for this type.',
        'Work the yearly items from the office copy of Section 10.',
      ],
      confidence: 'medium',
      sourceIds: ['as1851-s10', 'amsa-707', 'fpa-servicing'],
    },
    {
      activity: 'five-yearly',
      intervalMonths: pressure.intervalMonths,
      label: ACTIVITY_LABEL['five-yearly'],
      what: [
        'Discharge the extinguisher, strip it, replace the consumable parts, pressure test the body and recharge it.',
        'Counted from the date of manufacture stamped on the cylinder, not from the last service.',
      ],
      confidence: pressure.confidence,
      sourceIds: pressure.sourceIds,
      dispute: pressure.dispute,
    },
  ];
}

export interface PressureTestInterval {
  intervalMonths: number;
  /** Where the clock starts. For this activity it is the cylinder, not the last service. */
  anchor: 'date-of-manufacture';
  confidence: Confidence;
  sourceIds: SourceId[];
  dispute?: string;
  note: string;
}

/**
 * When the body has to be pressure tested.
 *
 * Sixty months for every type, and for carbon dioxide that answer is contested.
 * One set of trade guidance puts CO₂ on a ten-year hydrostatic cycle on the
 * gas-cylinder basis; the sources that describe AS 1851 Section 10 put every
 * portable extinguisher on five years. The shorter interval is answered with,
 * because being early to a pressure test costs a service call and being late to
 * one leaves a high-pressure cylinder in a corridor past its test date. The
 * disagreement travels with the answer rather than being resolved silently.
 */
export function pressureTestInterval(type: ExtinguisherType): PressureTestInterval {
  if (type === 'carbon-dioxide') {
    return {
      intervalMonths: 60,
      anchor: 'date-of-manufacture',
      confidence: 'low',
      sourceIds: ['as1851-s10', 'firewize-5yr', 'co2-ten-year-claim'],
      dispute:
        'AS 1851 Section 10 guidance puts every portable on five years; one contractor puts CO₂ on a ten-yearly test. '
        + 'Five years is used as the shorter. Check the office copy before quoting either.',
      note:
        'A CO₂ body is a high-pressure cylinder and is tested at a gas cylinder test station, not on the van.',
    };
  }
  if (type === 'halon') {
    return {
      intervalMonths: 60,
      anchor: 'date-of-manufacture',
      confidence: 'low',
      sourceIds: ['dcceew-halon'],
      note: 'Not tested: halon is surrendered to the National Halon Bank.',
    };
  }
  return {
    intervalMonths: 60,
    anchor: 'date-of-manufacture',
    confidence: 'medium',
    sourceIds: ['as1851-s10', 'fpa-servicing', 'firewize-5yr'],
    note: 'Discharged, stripped, tested and recharged on the anniversary of manufacture.',
  };
}

/**
 * What an adverse environment does to the intervals.
 *
 * AS 1851-2012 carries a separate regime for equipment in aggressive
 * environments — coastal salt, a dusty or corrosive plant, constant vibration.
 * Safe QLD services plenty of it: South East Queensland is coastal from the
 * Gold Coast to the Sunshine Coast.
 *
 * This function deliberately does not shorten anything. The clause number is
 * second-hand and the increased frequency it requires is not established here,
 * so returning a shortened interval would be inventing a compliance position.
 * It returns the warning instead, which is the honest half of the answer.
 */
export function adverseEnvironmentCaution(): { statement: string; sourceIds: SourceId[]; confidence: Confidence } {
  return {
    statement:
      'Coastal, dusty or corrosive sites: AS 1851-2012 Clause 1.13 increases the frequency. The intervals shown have '
      + 'NOT been shortened; set them from the office copy.',
    sourceIds: ['wormald-adverse', 'as1851-s10'],
    confidence: 'low',
  };
}

// ===========================================================================
// Dates, at the precision they were actually written at
// ===========================================================================

export type DatePrecision = 'day' | 'month' | 'year';

/**
 * A date the register recorded, as the span of days it could actually be.
 *
 * This is the whole answer to the "Jun-25" problem. A month-precision record is
 * not the first of the month and it is not the fifteenth; it is a thirty-day
 * span, and every piece of arithmetic downstream carries the span rather than
 * collapsing it. Add sixty months to both ends and you get the span the next
 * pressure test falls in — which is the truth, and is what a technician can act
 * on without being told a false date.
 */
export interface DateSpan {
  earliest: string;
  latest: string;
  precision: DatePrecision;
  /** How it was written on the register. */
  raw: string;
  /** d/m/yyyy for a day, "June 2025" for a month, "2025" for a year. */
  label: string;
}

const MONTH_LABEL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Days in a month, UTC, so February behaves in a leap year. */
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Australian display. Never m/d/y, anywhere, for any reason. */
export function formatAuDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

/**
 * Turns whatever the register said into the span of days it could be.
 *
 * Delegates the reading to the register parser so there is one Australian date
 * reader in this codebase and not two. An unreadable cell and a blank cell both
 * come back undefined, because neither can be scheduled from and pretending
 * otherwise is how an asset ends up permanently and wrongly overdue.
 */
export function toSpan(value: string | ImpreciseDate | undefined): DateSpan | undefined {
  if (value === undefined) return undefined;
  const d = typeof value === 'string' ? parseImpreciseDate(value) : value;
  if (!d || d.year === undefined) return undefined;

  if (d.precision === 'day' && d.iso && d.month !== undefined && d.day !== undefined) {
    return { earliest: d.iso, latest: d.iso, precision: 'day', raw: d.raw, label: formatAuDate(d.iso) };
  }
  if (d.precision === 'month' && d.month !== undefined) {
    return {
      earliest: iso(d.year, d.month, 1),
      latest: iso(d.year, d.month, daysInMonth(d.year, d.month)),
      precision: 'month',
      raw: d.raw,
      label: `${MONTH_LABEL[d.month - 1]} ${d.year}`,
    };
  }
  if (d.precision === 'year') {
    return {
      earliest: iso(d.year, 1, 1),
      latest: iso(d.year, 12, 31),
      precision: 'year',
      raw: d.raw,
      label: String(d.year),
    };
  }
  return undefined;
}

/** Whole months between two ISO dates, ignoring the day. Negative when b precedes a. */
function monthsBetween(aIso: string, bIso: string): number {
  const [ay, am] = aIso.split('-').map(Number);
  const [by, bm] = bIso.split('-').map(Number);
  return (by! - ay!) * 12 + (bm! - am!);
}

// ===========================================================================
// What is due, and when
// ===========================================================================

export type DueState = 'overdue' | 'due' | 'upcoming' | 'unknown';

export const DUE_STATE_LABEL: Record<DueState, string> = {
  overdue: 'Overdue',
  due: 'Due now',
  upcoming: 'Upcoming',
  unknown: 'Cannot be worked out',
};

export interface DueAssessment {
  activity: ServiceActivity;
  intervalMonths: number;
  /**
   * Whether the schedule was counted from the cylinder or from the last
   * service. The first cannot drift; the second carries forward whatever drift
   * is already in the record, and says so.
   */
  anchoredTo: 'date-of-manufacture' | 'last-service';
  anchorNote: string;
  /** Occurrence number counted from the anchor. Occurrence 1 is the first recurrence. */
  occurrence: number;
  /** The span of days the next one falls in. One day wide where every input was to the day. */
  due: DateSpan;
  state: DueState;
  /** Days to the start and the end of the due span. Negative once past. */
  daysUntil: { earliest: number; latest: number };
  /**
   * Scheduled occurrences with no record against them. One five-yearly missed
   * on a cylinder is five years of an untested pressure vessel.
   */
  missedOccurrences: number;
  notes: string[];
  sourceIds: SourceId[];
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/** Adds whole months to both ends of a span using the app's own anchor arithmetic. */
function advance(span: DateSpan, frequency: Frequency, occurrence: number): DateSpan | undefined {
  const earliest = scheduledDate(span.earliest, frequency, occurrence);
  const latest = scheduledDate(span.latest, frequency, occurrence);
  if (!earliest || !latest) return undefined;
  if (span.precision === 'day') {
    return { earliest, latest, precision: 'day', raw: span.raw, label: formatAuDate(earliest) };
  }
  // A month-precision anchor advanced by a whole number of months is still a
  // month, but only when the interval is a whole number of months AND the span
  // did not start mid-month. Both hold here, so the label can name the month.
  const [ey, em] = earliest.split('-').map(Number);
  const [ly, lm] = latest.split('-').map(Number);
  const sameMonth = ey === ly && em === lm;
  return {
    earliest,
    latest,
    precision: span.precision,
    raw: span.raw,
    label: sameMonth
      ? `${MONTH_LABEL[em! - 1]} ${ey}`
      : `${MONTH_LABEL[em! - 1]} ${ey} to ${MONTH_LABEL[lm! - 1]} ${ly}`,
  };
}

export interface DueInput {
  activity: ServiceActivity;
  type: ExtinguisherType;
  /** Date of manufacture, stamped on the cylinder. The anchor, where it is known. */
  manufactured?: string | ImpreciseDate;
  /** When this activity was last actually carried out. */
  lastDone?: string | ImpreciseDate;
  /** ISO date. Queensland is UTC+10 with no daylight saving, so "today" is unambiguous here. */
  today: string;
}

/**
 * When the next one falls due.
 *
 * Two rules from the rest of the app are enforced here and both exist to stop
 * the same failure.
 *
 * The **anchor rule**: occurrences are counted from the date of manufacture,
 * never from the last service. Counting from the last service makes drift
 * compound — a five-yearly done eight months late silently becomes the new
 * baseline, and forty years of cylinder life turns into five missed tests while
 * every individual service looks compliant. Where there is no date of
 * manufacture the schedule is counted from the last service, and the result
 * says so in `anchoredTo` and in a note, because that is a materially weaker
 * answer and a reader is entitled to know.
 *
 * The **precision rule**: an imprecise anchor produces an imprecise due span.
 * Nothing here converts "Jun-25" into a day.
 *
 * No tolerance window is applied. The Section 6 tolerance tables this app holds
 * govern detection and alarm systems; what tolerance Section 10 allows on an
 * extinguisher routine is not known here, so none is assumed. That makes this
 * function report "due" slightly earlier than a tolerance would, which is the
 * safe direction to be wrong in, and it is stated in the notes rather than left
 * for someone to discover.
 */
export function nextDue(input: DueInput): DueAssessment | Refused {
  const frequency = ACTIVITY_FREQUENCY[input.activity];
  const spec = intervalsFor(input.type).find((i) => i.activity === input.activity)!;
  // The Queensland day, should a caller hand over an instant by mistake: at
  // half past eight in the morning the UTC day is still yesterday.
  const today = qldIsoDay(input.today) ?? input.today;
  const notes: string[] = [];
  const sourceIds: SourceId[] = [...spec.sourceIds];

  // The occurrence count uses the interval in months and the date arithmetic
  // uses the Section 6 frequency of the same length. They agree today for all
  // three activities, and the day one of them moves — a ten-yearly CO₂ test
  // settled in this module's favour, say — they must not silently disagree, or
  // the app counts occurrences at one interval and dates them at another.
  const frequencyMonths = frequencySpec(frequency)?.intervalMonths;
  if (frequencyMonths !== spec.intervalMonths) {
    return {
      known: false,
      code: 'interval-mismatch',
      reason:
        `The ${ACTIVITY_LABEL[input.activity].toLowerCase()} is held at ${spec.intervalMonths} months but its date `
        + `arithmetic runs on a ${frequencyMonths ?? 'missing'}-month schedule. The two disagree, so no due date is `
        + 'given.',
      whatToDo: 'Report it to the office. The register is not at fault.',
      sourceIds,
    };
  }

  const manufactured = toSpan(input.manufactured);
  const lastDone = toSpan(input.lastDone);

  if (!manufactured && !lastDone) {
    return {
      known: false,
      code: 'no-anchor-date',
      reason: 'No date of manufacture and no last service: nothing to count from.',
      whatToDo: 'Read the date stamped on the cylinder.',
      sourceIds: ['as1841-series', 'firewize-5yr'],
    };
  }

  if (manufactured && manufactured.earliest > today) {
    return {
      known: false,
      code: 'manufacture-in-future',
      reason: `Date of manufacture ${manufactured.label} is in the future.`,
      whatToDo: 'Re-read the stamp and check the year.',
      sourceIds: ['as1841-series'],
    };
  }

  // A service dated in the future is the same class of error as a date of
  // manufacture in the future — a typed year, usually — and it is worse to
  // schedule from, because it is the date the whole schedule counts forward
  // from where there is no cylinder stamp. Scheduled from, the asset reports
  // "upcoming" until the typo is found, which on a five-yearly is years.
  if (lastDone && lastDone.earliest > today) {
    return {
      known: false,
      code: 'service-in-future',
      reason: `Last service ${lastDone.label} has not happened yet.`,
      whatToDo: 'Correct the date in the register before scheduling from it.',
      sourceIds: ['as1841-series'],
    };
  }

  if (manufactured && lastDone && lastDone.latest < manufactured.earliest) {
    return {
      known: false,
      code: 'service-before-manufacture',
      reason: `Last service ${lastDone.label} is before the date of manufacture, ${manufactured.label}.`,
      whatToDo: 'One date is wrong. Do not schedule from either until the register is fixed.',
      sourceIds: ['as1841-series'],
    };
  }

  const anchor = manufactured ?? lastDone!;
  const anchoredTo = manufactured ? 'date-of-manufacture' : 'last-service';

  if (anchoredTo === 'last-service') {
    notes.push('Counted from the last service, so any lateness carries forward. Enter the manufacture date on the cylinder.');
  }

  // Which occurrence has already been done.
  //
  // Rounding to the nearest occurrence — the obvious way — credits a service to
  // an occurrence it happened a long way before. A five-yearly recorded three
  // years after manufacture rounds to occurrence 1, so the app reports the next
  // test in 2030 and the occurrence that fell due in 2025 disappears: a
  // pressure vessel five years out of test, reading as compliant, with nothing
  // in `missedOccurrences` to show it. That is the exact failure the anchor
  // rule exists to stop, arriving through the back door.
  //
  // So a service is only counted against an occurrence it fell within a quarter
  // of the interval of — six weeks on a six-monthly, fifteen months on a
  // five-yearly. Inside that it is an early service and counts; outside it, the
  // occurrence is still outstanding and a note says which service was not
  // enough to satisfy it. This errs early, in the same direction as everything
  // else in this function.
  const EARLY_CREDIT_FRACTION = 0.25;
  let doneOccurrence = 0;
  let earlyCredit: { months: number; occurrence: number } | undefined;
  let notCredited: { months: number; occurrence: number } | undefined;
  if (manufactured && lastDone) {
    const elapsed = Math.max(0, monthsBetween(anchor.earliest, lastDone.earliest));
    const whole = Math.floor(elapsed / spec.intervalMonths);
    const remainder = elapsed - whole * spec.intervalMonths;
    const monthsShortOfNext = spec.intervalMonths - remainder;
    if (remainder === 0) {
      doneOccurrence = whole;
    } else if (monthsShortOfNext <= spec.intervalMonths * EARLY_CREDIT_FRACTION) {
      doneOccurrence = whole + 1;
      earlyCredit = { months: monthsShortOfNext, occurrence: doneOccurrence };
    } else {
      doneOccurrence = whole;
      notCredited = { months: monthsShortOfNext, occurrence: whole + 1 };
    }
  }

  // The occurrence that ought to have been done by now, from the anchor alone.
  let dueByNow = 0;
  while (dueByNow < 400) {
    const span = advance(anchor, frequency, dueByNow + 1);
    if (!span || span.latest > today) break;
    dueByNow += 1;
  }

  // The next one due is the one after the last one recorded. Where nothing is
  // recorded that is occurrence 1, counted from the cylinder — which on an old
  // extinguisher with no service history reports the first test as decades
  // overdue, and it is.
  const nextOccurrence = doneOccurrence + 1;
  const due = advance(anchor, frequency, nextOccurrence);
  if (!due) {
    return {
      known: false,
      code: 'anchor-unusable',
      reason: 'The due date could not be worked out from the anchor date.',
      whatToDo: 'Check the anchor date is a real date and re-run.',
      sourceIds,
    };
  }

  const state: DueState = today > due.latest ? 'overdue' : today >= due.earliest ? 'due' : 'upcoming';
  const missedOccurrences = Math.max(0, dueByNow - nextOccurrence + 1);

  if (missedOccurrences > 1) {
    notes.push(`${missedOccurrences} missed. The date shown is the oldest one still outstanding.`);
  }
  if (notCredited && lastDone) {
    notes.push(
      `Last one recorded, ${lastDone.label}, was ${notCredited.months} months before occurrence `
      + `${notCredited.occurrence}: too early to count, so that one is still outstanding.`,
    );
  }
  if (earlyCredit && lastDone) {
    notes.push(
      `Last one recorded, ${lastDone.label}, was ${earlyCredit.months} month`
      + `${earlyCredit.months === 1 ? '' : 's'} before occurrence ${earlyCredit.occurrence} and is counted as it.`,
    );
  }
  if (due.precision !== 'day') {
    notes.push(`Recorded as "${anchor.raw}", so it is due within ${due.label}, not on a set day.`);
  }
  notes.push('No tolerance window applied.');
  if (spec.dispute) notes.push(spec.dispute);

  return {
    activity: input.activity,
    intervalMonths: spec.intervalMonths,
    anchoredTo,
    anchorNote:
      anchoredTo === 'date-of-manufacture'
        ? `Counted from the date of manufacture, ${anchor.label}.`
        : `Counted from the last service, ${anchor.label}.`,
    occurrence: nextOccurrence,
    due,
    state,
    daysUntil: { earliest: daysBetween(today, due.earliest), latest: daysBetween(today, due.latest) },
    missedOccurrences,
    notes,
    sourceIds,
  };
}

// ===========================================================================
// Condemnation
// ===========================================================================

export type ConditionFinding =
  | 'halon-agent'
  | 'failed-pressure-test'
  | 'repaired-by-welding'
  | 'heat-or-fire-damage'
  | 'shell-corrosion-pitting'
  | 'shell-damage-dent-gouge'
  | 'valve-or-thread-damage'
  | 'illegible-or-missing-markings'
  | 'no-date-of-manufacture'
  | 'non-refillable-discharged'
  | 'hose-perished'
  | 'seal-broken-or-discharged'
  | 'powder-packed';

/**
 * What each finding means for the asset.
 *
 * `condemn` — permanently out of service, whatever it costs.
 * `repairable` — a defect, and a serviceable one.
 * `judgement` — a person with eyes on the asset has to decide, and this app
 * will not decide it from a checkbox. That third value is the reason this
 * module exists in the shape it does: "how deep is that pitting" is not a
 * question a form can answer, and answering it anyway is how a corroded
 * pressure vessel goes back on a wall.
 */
export type ConditionOutcome = 'condemn' | 'repairable' | 'judgement';

export interface ConditionRule {
  id: ConditionFinding;
  label: string;
  outcome: ConditionOutcome;
  reason: string;
  /** What has to happen next. On a judgement, who has to make it. */
  action: string;
  confidence: Confidence;
  sourceIds: SourceId[];
}

export const CONDITION_RULES: Record<ConditionFinding, ConditionRule> = {
  'halon-agent': {
    id: 'halon-agent',
    label: 'Charged with halon (BCF, halon 1211 or 1301)',
    outcome: 'condemn',
    reason:
      'Halon has not been lawful to own or use in Australia since 1995 outside an approved essential use. This is a '
      + 'legal position, not a condition assessment, and it outranks every other finding on the asset.',
    action:
      'Do not discharge or refill. Remove from service, surrender it to the National Halon Bank (free since 1 January '
      + '2023), and tell the owner in writing.',
    confidence: 'high',
    sourceIds: ['dcceew-halon'],
  },
  'failed-pressure-test': {
    id: 'failed-pressure-test',
    label: 'Failed the pressure test',
    outcome: 'condemn',
    reason: 'A body that will not hold its test pressure is a pressure vessel that has failed. There is no repair.',
    action: 'Condemn, render unusable so it cannot be returned to a wall, and replace the asset.',
    confidence: 'high',
    sourceIds: ['as1851-s10', 'firewize-5yr'],
  },
  'repaired-by-welding': {
    id: 'repaired-by-welding',
    label: 'Body has been welded, brazed or soldered',
    outcome: 'condemn',
    reason:
      'Heat applied to a pressure vessel changes the metal it was tested as. A welded extinguisher body is not the '
      + 'body that passed its test, whatever the weld looks like.',
    action: 'Condemn and replace. Do not pressure test it to see.',
    confidence: 'medium',
    sourceIds: ['as1851-s10'],
  },
  'heat-or-fire-damage': {
    id: 'heat-or-fire-damage',
    label: 'Exposed to fire or significant heat',
    outcome: 'condemn',
    reason:
      'A cylinder that has been in a fire has been heat-treated by it, and blistered or discoloured paint is the only '
      + 'outward sign. The temper of the metal cannot be assessed on site.',
    action: 'Condemn and replace. Record where it was and why, because the fire itself is likely to be an incident.',
    confidence: 'medium',
    sourceIds: ['as1851-s10'],
  },
  'shell-corrosion-pitting': {
    id: 'shell-corrosion-pitting',
    label: 'Corrosion or pitting on the body',
    outcome: 'judgement',
    reason:
      'Surface rust on a coastal site is cosmetic; pitting that has taken metal out of the wall condemns it. Depth, '
      + 'extent and position decide.',
    action: 'Decide on site and photograph it. If it is close, send it to the five-yearly strip, not back on the wall.',
    confidence: 'medium',
    sourceIds: ['amsa-707', 'wormald-adverse'],
  },
  'shell-damage-dent-gouge': {
    id: 'shell-damage-dent-gouge',
    label: 'Dented, gouged or deformed body',
    outcome: 'judgement',
    reason:
      'A shallow dent in the skirt is not the same as a gouge across a weld seam. On a CO₂ cylinder, working at far '
      + 'higher pressure, the same damage is a more serious finding than it would be on a stored-pressure unit.',
    action: 'Decide on site and photograph it. On a CO₂ body, if in doubt, condemn.',
    confidence: 'medium',
    sourceIds: ['amsa-707'],
  },
  'valve-or-thread-damage': {
    id: 'valve-or-thread-damage',
    label: 'Damaged valve, neck or neck thread',
    outcome: 'judgement',
    reason:
      'A damaged valve is often a replacement part. A damaged neck thread is the body, and the body is the pressure '
      + 'vessel. The two look similar and end very differently.',
    action:
      'Establish which it is before quoting a part. Thread damage on the body condemns the extinguisher; a valve is '
      + 'changed at the five-yearly.',
    confidence: 'low',
    sourceIds: ['as1851-s10'],
  },
  'illegible-or-missing-markings': {
    id: 'illegible-or-missing-markings',
    label: 'Type, rating or instructions unreadable',
    outcome: 'judgement',
    reason:
      'Nobody can select it, refill it with the right agent, or use it under stress. A label can be replaced; stamped '
      + 'markings cannot.',
    action:
      'Replace the label if the stamping shows what it is. If the agent cannot be established, condemn it: an unknown '
      + 'agent must not go on an unknown fire.',
    confidence: 'medium',
    sourceIds: ['amsa-707', 'as1841-series'],
  },
  'no-date-of-manufacture': {
    id: 'no-date-of-manufacture',
    label: 'No readable date of manufacture',
    outcome: 'judgement',
    reason: 'The five-yearly counts from the date stamp. Without it the pressure test date is unknown.',
    action: 'Check the base and the neck first. If there is no stamp, replace it at the next five-yearly.',
    confidence: 'medium',
    sourceIds: ['as1841-series', 'firewize-5yr'],
  },
  'non-refillable-discharged': {
    id: 'non-refillable-discharged',
    label: 'Non-refillable unit that has been used or lost pressure',
    outcome: 'condemn',
    reason:
      'A non-rechargeable extinguisher is built not to be refilled. Once it has discharged there is nothing to service.',
    action: 'Replace the asset. Do not attempt a refill.',
    confidence: 'medium',
    sourceIds: ['as1841-series'],
  },
  'hose-perished': {
    id: 'hose-perished',
    label: 'Hose or horn cracked, perished or obstructed',
    outcome: 'repairable',
    reason: 'A consumable part. It is a defect until it is changed, but the asset is sound.',
    action: 'Replace the hose assembly and re-inspect.',
    confidence: 'high',
    sourceIds: ['amsa-707'],
  },
  'seal-broken-or-discharged': {
    id: 'seal-broken-or-discharged',
    label: 'Anti-tamper seal broken, or partially discharged',
    outcome: 'repairable',
    reason:
      'A broken seal means it may have been operated, and an extinguisher that has been operated at all no longer '
      + 'holds a full charge however little came out.',
    action: 'Refill and reseal. A partly discharged unit is refilled, not topped up or left.',
    confidence: 'medium',
    sourceIds: ['fpa-servicing'],
  },
  'powder-packed': {
    id: 'powder-packed',
    label: 'Powder has packed and will not free-flow',
    outcome: 'repairable',
    reason:
      'Packed powder will not discharge no matter what the gauge reads, which makes the gauge check on a powder unit '
      + 'a partial check at best.',
    action: 'Strip, replace the powder charge and recharge. Check the mounting: vibration is the usual cause.',
    confidence: 'medium',
    sourceIds: ['amsa-707'],
  },
};

export type CondemnationVerdict = 'condemn' | 'serviceable' | 'undetermined';

export interface ConditionAssessment {
  verdict: CondemnationVerdict;
  /** Findings that condemn the asset outright, worst first. */
  condemning: ConditionRule[];
  /** Findings a person has to rule on. Present means the verdict cannot be "serviceable". */
  needsJudgement: ConditionRule[];
  /** Findings that are defects but not condemnations. */
  repairable: ConditionRule[];
  /** Findings passed in that this app has no rule for. Reported, never ignored. */
  unrecognised: string[];
  statement: string;
  sourceIds: SourceId[];
}

export interface ConditionInput {
  type?: ExtinguisherType;
  findings: (ConditionFinding | string)[];
  /**
   * Whether anyone actually looked. Absent findings from an asset nobody
   * inspected is not a clean bill of health, and this is the flag that stops it
   * being read as one.
   */
  inspected: boolean;
}

/**
 * Condemn, repair, or send it back to a human.
 *
 * The important behaviour is the two ways this refuses to say "serviceable".
 * The first is an asset nobody inspected — no findings because nobody looked is
 * not the same as no findings because there is nothing wrong. The second is any
 * finding whose outcome is a judgement: those come back as `undetermined` with
 * the question named, and a technician answers them. Rounding either of those
 * to "serviceable" is how a bad cylinder gets a green tag.
 *
 * Halon is handled ahead of everything else. It is the one finding here that is
 * a legal obligation rather than an engineering assessment, and it applies to a
 * unit in perfect condition.
 */
export function assessCondition(input: ConditionInput): ConditionAssessment {
  const condemning: ConditionRule[] = [];
  const needsJudgement: ConditionRule[] = [];
  const repairable: ConditionRule[] = [];
  const unrecognised: string[] = [];

  // The same finding ticked twice is one finding. Left in, it prints the
  // condemnation reason twice on a report and counts two defects where there is
  // one.
  const findings = [...new Set(input.findings)];
  // The agent itself is a finding. A register that says "BCF" condemns the
  // asset whether or not anyone ticked the halon box.
  if (input.type === 'halon' && !findings.includes('halon-agent')) findings.push('halon-agent');

  for (const f of findings) {
    const rule = CONDITION_RULES[f as ConditionFinding];
    if (!rule) {
      unrecognised.push(String(f));
      continue;
    }
    if (rule.outcome === 'condemn') condemning.push(rule);
    else if (rule.outcome === 'judgement') needsJudgement.push(rule);
    else repairable.push(rule);
  }

  // Halon first, then the rest in the order the rules are declared, which is
  // worst first by construction. Written as a rank rather than as a pairwise
  // "is it halon" test, which is not a consistent ordering and is not required
  // to be stable.
  const rank = (r: ConditionRule) => (r.id === 'halon-agent' ? 0 : 1);
  condemning.sort((a, b) => rank(a) - rank(b));

  const sourceIds = [
    ...condemning.flatMap((r) => r.sourceIds),
    ...needsJudgement.flatMap((r) => r.sourceIds),
    ...repairable.flatMap((r) => r.sourceIds),
  ];

  if (condemning.length) {
    return {
      verdict: 'condemn',
      condemning,
      needsJudgement,
      repairable,
      unrecognised,
      statement:
        `Out of service permanently: ${condemning.map((r) => r.label.toLowerCase()).join('; ')}. ` +
        condemning[0]!.action,
      sourceIds: sourceIds.length ? sourceIds : ['as1851-s10'],
    };
  }

  if (!input.inspected) {
    return {
      verdict: 'undetermined',
      condemning,
      needsJudgement,
      repairable,
      unrecognised,
      statement: 'Not inspected, so no verdict. No findings from an unchecked extinguisher is not a pass.',
      sourceIds: ['as1851-s10', 'amsa-707'],
    };
  }

  if (unrecognised.length) {
    return {
      verdict: 'undetermined',
      condemning,
      needsJudgement,
      repairable,
      unrecognised,
      statement: `No rule for ${unrecognised.map((u) => `"${u}"`).join(', ')}. Decide on site and record it.`,
      sourceIds: sourceIds.length ? sourceIds : ['as1851-s10'],
    };
  }

  if (needsJudgement.length) {
    return {
      verdict: 'undetermined',
      condemning,
      needsJudgement,
      repairable,
      unrecognised,
      statement:
        `Decide on site: ${needsJudgement.map((r) => r.label.toLowerCase()).join('; ')}. Until then it is neither `
        + 'condemned nor serviceable.',
      sourceIds,
    };
  }

  if (repairable.length) {
    return {
      verdict: 'serviceable',
      condemning,
      needsJudgement,
      repairable,
      unrecognised,
      statement:
        `Serviceable with defects: ${repairable.map((r) => r.label.toLowerCase()).join('; ')}. `
        + 'Rectify and re-inspect; the body itself is sound.',
      sourceIds,
    };
  }

  return {
    verdict: 'serviceable',
    condemning,
    needsJudgement,
    repairable,
    unrecognised,
    statement: 'Inspected: nothing takes it out of service. The inside of the body is only seen at the five-yearly.',
    sourceIds: ['as1851-s10', 'amsa-707'],
  };
}

// ===========================================================================
// Charge and weight
// ===========================================================================

export interface ChargeTolerance {
  percentOfCharge: number;
  /**
   * Where the figure came from.
   *
   * `manufacturer-plate` is read off the extinguisher in the technician's hand
   * and has no document behind it, so it carries no `sourceIds` — and must not
   * be given one. Stamping a plate reading with a standard's reference, which
   * is what an empty-array fallback did here, puts AS 1851 Section 10 beside a
   * number that AS 1851 never stated, in a document a client reads.
   */
  origin: 'manufacturer-plate';
  confidence: Confidence;
  sourceIds: SourceId[];
  /** Why this figure should be treated carefully. Always present. */
  caveat: string;
}

/**
 * The permitted variation in charge mass: the figure on this extinguisher's
 * own plate, and nothing else.
 *
 * Weighing is the check, and the pass or fail is entirely a function of the
 * tolerance applied. No Australian publication states one, so none is held
 * here for any type — not even carbon dioxide, where the only figure in
 * circulation is North American. Every type gets a verdict once the plate
 * figure is entered, and none gets one before.
 */
export function chargeTolerance(
  type: ExtinguisherType,
  manufacturerPercent?: number,
): ChargeTolerance | Refused {
  if (manufacturerPercent !== undefined) {
    if (!Number.isFinite(manufacturerPercent) || manufacturerPercent <= 0 || manufacturerPercent >= 100) {
      return {
        known: false,
        code: 'tolerance-not-a-percentage',
        reason: `${manufacturerPercent}% is not a usable tolerance.`,
        whatToDo: 'Re-read the plate. It is a percentage of the charge, not of the gross mass.',
        sourceIds: ['as1851-s10'],
      };
    }
    return {
      percentOfCharge: manufacturerPercent,
      origin: 'manufacturer-plate',
      confidence: 'high',
      sourceIds: [],
      caveat: 'From the plate on this extinguisher. Photograph the plate.',
    };
  }
  return {
    known: false,
    code: 'no-charge-tolerance',
    reason: `No plate tolerance entered for this ${PROFILES[type].shortLabel} unit.`,
    whatToDo: 'Enter the tolerance from the plate.',
    sourceIds: [],
  };
}

export type ChargeState = 'within-tolerance' | 'undercharged' | 'overcharged';

export interface ChargeCheck {
  /** Grams throughout. Whole grams, so a scale reading never becomes a float sum. */
  actualChargeGrams: number;
  expectedChargeGrams: number;
  differenceGrams: number;
  /** Difference as a percentage of the expected charge, to one decimal. */
  differencePercent: number;
  tolerancePercent: number;
  /** Where the tolerance came from: always this asset's plate. */
  toleranceOrigin: ChargeTolerance['origin'];
  toleranceCaveat: string;
  state: ChargeState;
  statement: string;
  confidence: Confidence;
  sourceIds: SourceId[];
}

export interface ChargeInput {
  type: ExtinguisherType;
  /** Empty mass stamped on the cylinder, in grams. */
  tareGrams: number;
  /** Mass on the scales now, in grams. */
  grossGrams: number;
  /** Nominal agent charge from the label, in grams. */
  nominalChargeGrams?: number;
  /** Full gross mass from the label, in grams. Used when no nominal charge is marked. */
  labelledFullGrossGrams?: number;
  /** The permitted variation printed on this extinguisher, as a percentage of the charge. */
  manufacturerTolerancePercent?: number;
}

/**
 * A mass this module will do arithmetic on: a whole, non-negative number of
 * grams.
 *
 * The integer test is the point of it. Everything downstream is subtraction and
 * a comparison, and once one input is a float the answer prints as 3400.2 g
 * short — or 3399.9999999999995 — on a document. A scale reads whole grams and
 * the stamping is whole grams, so a fraction here is a unit that has already
 * gone wrong somewhere (kilograms typed into a grams field is the usual one)
 * and is refused rather than rounded into looking right.
 */
const isWholeGrams = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0;

/**
 * Whether the extinguisher is holding its charge.
 *
 * Works in whole grams for the same reason the rates module works in whole
 * cents: a scale reading is an integer, and turning it into a float so it can
 * be compared against another float is how 4.5 kg becomes 4.499999999999999.
 *
 * It refuses in five separate places, and each of them is a real record seen on
 * a register: a gross mass at or below the tare, a tare nobody recorded, no
 * expected charge to compare against, no tolerance read off the plate, and a
 * tolerance figure that is not a percentage.
 */
export function checkCharge(input: ChargeInput): ChargeCheck | Refused {
  const { type, tareGrams, grossGrams } = input;

  const missingMass = (n: unknown) => typeof n !== 'number' || !Number.isFinite(n) || n < 0;
  if (missingMass(tareGrams) || missingMass(grossGrams)) {
    return {
      known: false,
      code: 'mass-not-read',
      reason: 'Tare or gross is missing.',
      whatToDo: 'Tare off the cylinder stamping, gross off the scales, both in grams.',
      sourceIds: ['amsa-707'],
    };
  }

  if (!isWholeGrams(tareGrams) || !isWholeGrams(grossGrams)) {
    return {
      known: false,
      code: 'mass-not-whole-grams',
      reason: `${!isWholeGrams(tareGrams) ? tareGrams : grossGrams} g is not a whole number of grams.`,
      whatToDo: 'Enter whole grams. A decimal is usually kilograms in a grams field.',
      sourceIds: ['amsa-707'],
    };
  }

  if (grossGrams <= tareGrams) {
    return {
      known: false,
      code: 'gross-at-or-below-tare',
      reason: `Weighs ${grossGrams} g against a stamped tare of ${tareGrams} g: no agent at all.`,
      whatToDo:
        'Check the tare stamping, and for a scale still in kilograms. If both are right it is empty: raise a defect.',
      sourceIds: ['amsa-707'],
    };
  }

  const expected =
    input.nominalChargeGrams !== undefined
      ? input.nominalChargeGrams
      : input.labelledFullGrossGrams !== undefined
        ? input.labelledFullGrossGrams - tareGrams
        : undefined;

  if (expected !== undefined && expected > 0 && !isWholeGrams(expected)) {
    return {
      known: false,
      code: 'mass-not-whole-grams',
      reason: `The charge works out at ${expected} g, not a whole number of grams.`,
      whatToDo: 'Re-read the nominal charge off the label, in whole grams.',
      sourceIds: ['amsa-707'],
    };
  }

  if (expected === undefined || !isWholeGrams(expected) || expected <= 0) {
    return {
      known: false,
      code: 'no-expected-charge',
      reason: 'No nominal charge, so nothing to compare the weight against.',
      whatToDo: 'Enter the charge from the label.',
      sourceIds: ['amsa-707', 'fpa-servicing'],
    };
  }

  const tolerance = chargeTolerance(type, input.manufacturerTolerancePercent);
  if (isRefused(tolerance)) return tolerance;

  const actual = grossGrams - tareGrams;
  const difference = actual - expected;
  const differencePercent = Math.round((difference / expected) * 1000) / 10;
  // Compared as grams times a hundred against a percentage, so the tolerance
  // itself never becomes a float either. 10% of 3 505 g is 350.5 g, and a
  // 350 g loss is inside it — cross-multiplying keeps that decision exact
  // instead of resting on how 350.50000000000006 compares.
  const allowedTimes100 = expected * tolerance.percentOfCharge;

  const state: ChargeState =
    Math.abs(difference) * 100 <= allowedTimes100
      ? 'within-tolerance'
      : difference < 0
        ? 'undercharged'
        : 'overcharged';

  const statement =
    state === 'within-tolerance'
      ? `Holding ${actual} g against ${expected} g nominal (${differencePercent > 0 ? '+' : ''}${differencePercent}%), `
        + `within ±${tolerance.percentOfCharge}%.`
      : state === 'undercharged'
        ? `Short by ${Math.abs(difference)} g (${Math.abs(differencePercent)}%) against ±${tolerance.percentOfCharge}%. `
          + 'Recharge it.'
        : `Over by ${difference} g (${differencePercent}%) against ±${tolerance.percentOfCharge}%. Check the tare `
          + 'stamping and what it was filled with.';

  return {
    actualChargeGrams: actual,
    expectedChargeGrams: expected,
    differenceGrams: difference,
    differencePercent,
    tolerancePercent: tolerance.percentOfCharge,
    toleranceOrigin: tolerance.origin,
    toleranceCaveat: tolerance.caveat,
    state,
    statement,
    confidence: tolerance.confidence,
    // Whatever the tolerance came from and nothing else. A plate reading has no
    // document behind it and is left with an empty list rather than being
    // credited to a standard that never stated it.
    sourceIds: tolerance.sourceIds,
  };
}

/**
 * Whether weighing is the check or a cross-check on this type.
 *
 * A carbon dioxide extinguisher has no gauge, so the scale is the only evidence
 * it is full. Everything else has a gauge, and the weight is a second opinion
 * on it — a useful one, because a gauge can read fine on a unit that has leaked
 * and been re-pressurised with air.
 *
 * `null` where the profile does not know whether this one carries a gauge, and
 * that third answer matters on screen: returning false there tells a technician
 * "the gauge is the primary check on this type" about a cylinder that may not
 * have a gauge at all, which is the wrong instruction confidently given.
 */
export function weighingIsPrimaryCheck(type: ExtinguisherType): boolean | null {
  const gauge = PROFILES[type].hasPressureGauge;
  return gauge === null ? null : gauge === false;
}

// ===========================================================================
// The site rollup
// ===========================================================================

export interface RegisterEntry {
  assetId: string;
  location?: string;
  /** Where the type is already established. */
  type?: ExtinguisherType;
  /** The register's own "Extinguisher Type" cell, read where `type` is absent. */
  typeText?: string;
  /** Date stamped on the cylinder, however it was written. */
  manufactured?: string | ImpreciseDate;
  lastSixMonthly?: string | ImpreciseDate;
  lastYearly?: string | ImpreciseDate;
  /** The register's "Last 5 Yearly" column. */
  lastFiveYearly?: string | ImpreciseDate;
}

export interface ActivityRollup {
  activity: ServiceActivity;
  overdue: number;
  dueWithinHorizon: number;
  later: number;
  /** Assets whose position could not be worked out, with the reasons and their counts. */
  unknown: number;
  unknownReasons: { reason: string; count: number }[];
}

export interface TypeRollup {
  /** 'unclassified' is a real bucket, not a rounding of the others. */
  type: ExtinguisherType | 'unclassified';
  label: string;
  count: number;
  overdue: number;
  dueWithinHorizon: number;
  unknown: number;
  activities: ActivityRollup[];
}

export interface SiteRollup {
  total: number;
  horizonMonths: number;
  /** The last day inside the horizon, for the covering note on a proposal. */
  horizonEnds: string;
  byType: TypeRollup[];
  overdue: number;
  dueWithinHorizon: number;
  unknown: number;
  unclassified: number;
  /** Assets that must come off the wall regardless of any schedule. */
  condemnable: { assetId: string; reason: string }[];
  caveats: string[];
  sourceIds: SourceId[];
}

const ROLLUP_ACTIVITIES: ServiceActivity[] = ['six-monthly', 'yearly', 'five-yearly'];

function addMonthsIso(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const total = y! * 12 + (m! - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  return iso(ty, tm, Math.min(d!, daysInMonth(ty, tm)));
}

/**
 * What this site is going to need, split by type and activity.
 *
 * The question behind it is "what does this site cost me this year", and the
 * answer this function gives is deliberately in assets and activities rather
 * than in money. Rates are commercial terms and belong in the quoting module;
 * what the field app owes the office is an accurate count of what falls due,
 * broken down finely enough to price.
 *
 * Three disciplines carried over from the rest of the app:
 *
 *  - An asset whose type could not be read is counted in its own bucket and
 *    never distributed across the others. Forty unclassified extinguishers is a
 *    finding about the register, and burying them in the ABE count hides it.
 *  - An asset whose schedule could not be worked out is counted as unknown with
 *    its reason, not as compliant. A silent asset is the one that bites.
 *  - The caveats are part of the returned data rather than prose added by
 *    whatever screen renders it, so the numbers cannot travel without them.
 */
export function rollupSite(entries: RegisterEntry[], todayIso: string, horizonMonths = 12): SiteRollup {
  const today = qldIsoDay(todayIso) ?? todayIso;
  const horizonEnds = addMonthsIso(today, horizonMonths);

  const buckets = new Map<ExtinguisherType | 'unclassified', TypeRollup>();
  const condemnable: { assetId: string; reason: string }[] = [];
  let unclassified = 0;
  let ambiguousPowder = 0;
  let noAnchor = 0;

  const bucketFor = (type: ExtinguisherType | 'unclassified'): TypeRollup => {
    let b = buckets.get(type);
    if (!b) {
      b = {
        type,
        label: type === 'unclassified' ? 'Type not established' : PROFILES[type].label,
        count: 0,
        overdue: 0,
        dueWithinHorizon: 0,
        unknown: 0,
        activities: ROLLUP_ACTIVITIES.map((activity) => ({
          activity,
          overdue: 0,
          dueWithinHorizon: 0,
          later: 0,
          unknown: 0,
          unknownReasons: [],
        })),
      };
      buckets.set(type, b);
    }
    return b;
  };

  const lastDoneFor = (e: RegisterEntry, activity: ServiceActivity) =>
    activity === 'six-monthly' ? e.lastSixMonthly : activity === 'yearly' ? e.lastYearly : e.lastFiveYearly;

  for (const entry of entries) {
    let type: ExtinguisherType | undefined = entry.type;
    if (!type) {
      const match = classifyTypeText(entry.typeText);
      if (isRefused(match)) {
        if (match.code === 'type-cell-ambiguous-powder') ambiguousPowder += 1;
      } else {
        type = match.type;
      }
    }

    const bucket = bucketFor(type ?? 'unclassified');
    bucket.count += 1;
    if (!type) unclassified += 1;

    if (type === 'halon') {
      condemnable.push({
        assetId: entry.assetId,
        reason:
          'Charged with halon. Not lawful to keep in service in Australia — surrender to the National Halon Bank '
          + 'rather than scheduling it.',
      });
      // And then nothing else. A halon cylinder is counted on the site and left
      // out of the schedule entirely: pricing a five-yearly strip and pressure
      // test on a unit that has to be surrendered puts work in a proposal that
      // must never be carried out, and buries the one asset on the page that
      // needs a letter to the owner among a hundred ordinary services.
      continue;
    }

    // An unclassified asset still has a schedule: the intervals are the same
    // for every type and only the five-yearly's dispute note varies. Scheduling
    // it as ABE would be a guess; scheduling it on the shared intervals is not.
    const scheduleType: ExtinguisherType = type ?? 'dry-chemical-abe';
    let assetOverdue = false;
    let assetDueSoon = false;
    let assetUnknown = false;

    for (const activity of ROLLUP_ACTIVITIES) {
      const row = bucket.activities.find((a) => a.activity === activity)!;
      const result = nextDue({
        activity,
        type: scheduleType,
        manufactured: entry.manufactured,
        lastDone: lastDoneFor(entry, activity),
        today,
      });

      if (isRefused(result)) {
        row.unknown += 1;
        assetUnknown = true;
        if (result.code === 'no-anchor-date') noAnchor += 1;
        const existing = row.unknownReasons.find((r) => r.reason === result.reason);
        if (existing) existing.count += 1;
        else row.unknownReasons.push({ reason: result.reason, count: 1 });
        continue;
      }

      if (result.state === 'overdue') {
        row.overdue += 1;
        assetOverdue = true;
      } else if (result.due.earliest <= horizonEnds) {
        row.dueWithinHorizon += 1;
        assetDueSoon = true;
      } else {
        row.later += 1;
      }
    }

    if (assetOverdue) bucket.overdue += 1;
    if (assetDueSoon) bucket.dueWithinHorizon += 1;
    if (assetUnknown) bucket.unknown += 1;
  }

  const byType = [...buckets.values()].sort(
    (a, b) => b.count - a.count || String(a.type).localeCompare(String(b.type)),
  );

  const caveats: string[] = [
    'Counts are of assets and activities, not of money. Rates are commercial terms and are applied in the office '
    + 'system, not here.',
    'This is a statement about the register, and the register being right is an assumption. An extinguisher that was '
    + 'never entered is not counted, and no count here shows that.',
    'No tolerance window has been applied to any due date. What tolerance AS 1851 Section 10 allows is not '
    + 'established in this app, so due dates are treated as exact.',
  ];

  if (unclassified) {
    caveats.push(
      `${unclassified} ${unclassified === 1 ? 'asset has' : 'assets have'} no established type. They are counted `
      + 'separately and have not been distributed across the other types. Their intervals are the shared ones; their '
      + 'fire class ratings and prohibitions are unknown until someone reads the label.',
    );
  }
  if (ambiguousPowder) {
    caveats.push(
      `${ambiguousPowder} of those ${ambiguousPowder === 1 ? 'row says' : 'rows say'} powder without saying ABE or `
      + 'BE. The two share a white band and differ on Class A, so neither was assumed.',
    );
  }
  if (noAnchor) {
    caveats.push(
      `${noAnchor} scheduled ${noAnchor === 1 ? 'activity has' : 'activities have'} neither a date of manufacture nor `
      + 'a last-service date and could not be scheduled at all. They are counted as unknown, not as compliant.',
    );
  }
  if (condemnable.length) {
    caveats.push(
      `${condemnable.length} ${condemnable.length === 1 ? 'asset is' : 'assets are'} not serviceable at all and `
      + 'must come off the wall: see the condemnable list. They are counted in the site total and in their type, and '
      + 'left out of every due count — a service quoted on one of them is work that must not be carried out.',
    );
  }

  const totals = byType.reduce(
    (acc, b) => ({
      overdue: acc.overdue + b.overdue,
      dueWithinHorizon: acc.dueWithinHorizon + b.dueWithinHorizon,
      unknown: acc.unknown + b.unknown,
    }),
    { overdue: 0, dueWithinHorizon: 0, unknown: 0 },
  );

  return {
    total: entries.length,
    horizonMonths,
    horizonEnds,
    byType,
    ...totals,
    unclassified,
    condemnable,
    caveats,
    sourceIds: ['as1851-s10', 'amsa-707', 'fpa-servicing'],
  };
}

/**
 * The Queensland licensing note that belongs on any extinguisher document.
 *
 * Queensland is the only state that licenses the person who services an
 * extinguisher, and it licenses by class — a certify licence does not authorise
 * inspect-and-test work. The record of maintenance carries the licence number,
 * so the wrong class on the form is a defective statutory record rather than a
 * paperwork nicety.
 */
export const QLD_LICENSING_NOTE =
  'The QBCC licenses portable fire work by class. The class must cover the work done (a certify class does not cover '
  + 'inspect and test), and the licence number goes on the record.';

export const QLD_LICENSING_SOURCE: SourceId[] = ['qbcc-portable', 'fpa-servicing'];
