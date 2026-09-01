import { frequencySpec, scheduledDate, type Frequency } from '@/domain/qldCompliance';
import { parseImpreciseDate, type ImpreciseDate } from '@/parsers/assetRegister';

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
  | 'wormald-adverse'
  | 'nfpa10-co2-charge';

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
    ref: 'AS 1851-2012, Section 10 (routine service of portable and wheeled fire extinguishers)',
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
    ref: 'Australian Maritime Safety Authority, Guidance Notice AMSA 707 (2/17), February 2017, Attachment 1',
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
    ref: 'Fire Protection Association Australia, Fact Sheet V1 SFE1, "Servicing Fire Extinguishers — A Guide for Consumers"',
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
    ref: 'Firewize, "What is the date stamp on portable fire extinguishers", citing AS 1851-2012 Table 10.4.3 and AS/NZS 1841.1:2007 marking requirements',
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
    ref: 'Firechief Australia, fire extinguisher pressure testing guide — "CO2 extinguishers require testing every 10 years" against five years for most portables',
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
    ref: 'AS/NZS 1841 series: 1841.1 general requirements, then parts 2 to 8 by type',
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
    ref: 'AS 2444 (portable fire extinguishers and fire blankets — selection and location)',
    url: 'https://www.standards.org.au/standards-catalogue/standard-details?designation=as-2444-2001',
    confidence: 'medium',
    basis:
      'Named as the signage reference by the AMSA six-monthly item list. Cited here for scope only — nothing in this '
      + 'module decides placement, which is a design question and not a service one.',
  },
  'dcceew-halon': {
    id: 'dcceew-halon',
    what: 'That halon extinguishers may not be owned or used in Australia without an approved essential use, that surrendered halon goes to the National Halon Bank, and that disposal has been free of charge since 1 January 2023',
    ref: 'Department of Climate Change, Energy, the Environment and Water — Halon disposal; Australian Halon Management Strategy',
    url: 'https://www.dcceew.gov.au/environment/protection/ozone/halon/halon-disposal',
    confidence: 'high',
    basis:
      "The Commonwealth department's own page on its own scheme. This is the one condemnation in this module that is "
      + 'a legal obligation rather than a technical judgement, which is why it outranks every other finding.',
  },
  'qbcc-portable': {
    id: 'qbcc-portable',
    what: 'That Queensland licenses portable fire equipment work by class, and that a certify licence does not authorise inspect-and-test work',
    ref: 'Queensland Building and Construction Commission — fire protection (portable) certify licence class, scope of work',
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
    ref: 'Alexon (Australian supplier), fire extinguisher types, classes and colour bands',
    url: 'https://www.alexon.com.au/news/fire-extinguisher-types-a-complete-guide-to-classes-and-colour-bands',
    confidence: 'low',
    basis:
      "A supplier's own guide. Agrees with the other trade source on every band and on every prohibition that matters, "
      + 'and disagrees with it on whether ABE powder carries a Class C rating. Both readings are carried.',
  },
  'essentialfire-types': {
    id: 'essentialfire-types',
    what: 'Colour bands and fire classes, including BE powder and the class-by-class prohibitions',
    ref: 'Essential Fire Services (Australian contractor), Australian fire extinguisher types',
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
    ref: 'Wormald Australia, understanding adverse environments, citing AS 1851-2012 Clause 1.13',
    url: 'https://wormald.com.au/blog/understanding-adverse-environments/',
    confidence: 'low',
    basis:
      "A manufacturer's blog. Relied on only for the existence of the clause and the fact that servicing frequency "
      + 'increases in an adverse environment. By how much it increases is not established here, and this module will '
      + 'not shorten an interval on the strength of it.',
  },
  'nfpa10-co2-charge': {
    id: 'nfpa10-co2-charge',
    what: 'The ten-per-cent-of-charge weight loss threshold at which a carbon dioxide extinguisher is recharged',
    ref: 'North American carbon dioxide extinguisher service manual, written to NFPA 10',
    url: 'https://www.strike-first.com/site/assets/files/1031/co2_service_manual_v2.pdf',
    confidence: 'low',
    basis:
      'Not Australian and not AS 1851. Carried only so the figure a technician has probably heard can be shown with '
      + 'its actual origin attached. This module will not issue a pass or fail on it — see chargeTolerance().',
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
  A: 'Class A — ordinary combustibles',
  B: 'Class B — flammable and combustible liquids',
  C: 'Class C — flammable gases',
  D: 'Class D — combustible metals',
  E: 'Class E — electrically energised equipment',
  F: 'Class F — cooking oils and fats',
};

export const FIRE_CLASS_EXAMPLES: Record<FireClass, string> = {
  A: 'Timber, paper, cardboard, textiles, most plastics.',
  B: 'Petrol, diesel, solvents, paints, oils that are not cooking oils.',
  C: 'LPG, natural gas, acetylene — a leak alight at the point of escape.',
  D: 'Magnesium, sodium, lithium, titanium, and swarf of the same.',
  E: 'Switchboards, motors, appliances and cabling while still energised. De-energise and it becomes whatever it is made of.',
  F: 'Deep fryers, woks, griddles — cooking oils and fats at cooking temperature.',
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
  unrated: 'Not rated — will not put it out',
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
    'Do not extinguish a burning gas escape unless the supply can be isolated first. Putting the flame out while gas '
    + 'is still flowing fills the space with an explosive mixture and leaves the ignition source in it. Isolate, then '
    + 'deal with what the gas has set alight. This is a statement about the gas valve and not a rating: whether this '
    + "agent does anything to a gas fire is on the extinguisher's own label.",
  confidence: 'medium',
  dispute:
    'The two trade sources reached disagree on whether ABE powder carries a Class C rating at all. It makes no '
    + 'difference to what a technician should do, which is isolate the gas.',
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
    'Burning metal reacts with water and with carbon dioxide, and reduces both to fuel. Class D needs a purpose-made '
    + 'metal-fire agent, which Safe QLD does not carry and this app does not model. Nothing in this list will do it.',
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
          'The jet is a conductor. The operator is holding the other end of it. This is the prohibition that kills '
          + 'people, and a plain red cylinder in front of a switchboard is the commonest way it happens.',
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
      'Plain red with no band. Do not read an unbanded cylinder as "band missing" — that is what a water extinguisher '
      + 'looks like, and it is the one that must never go near electrical equipment.',
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
          'Same failure as water: the carrier flashes to steam below the oil surface and throws it out. Cooking oil '
          + 'is a Class F fire and takes wet chemical, not foam, whatever the foam is rated for on Class B.',
        confidence: 'high',
        sourceIds: ['alexon-types', 'essentialfire-types'],
      },
    ],
    handlingCautions: [
      'Foam concentrates are being reformulated across Australia as fluorinated foams are phased out. Check what the '
      + 'unit is actually charged with before refilling it, and check the site is not under a PFAS management plan.',
    ],
    sourceIds: ['as1841-series', 'alexon-types', 'essentialfire-types'],
  },

  'dry-chemical-abe': {
    type: 'dry-chemical-abe',
    label: 'Dry chemical powder — ABE',
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
          'The discharge splashes burning oil out of the vat, and powder does not cool. What is left is oil still above '
          + 'its auto-ignition temperature, so it relights — often after the operator has walked away believing it is '
          + 'out. This is the single most common wrong-extinguisher finding in a commercial kitchen.',
        confidence: 'high',
        sourceIds: ['alexon-types', 'essentialfire-types'],
      },
    ],
    handlingCautions: [
      'Discharged indoors it takes visibility to nothing in seconds. In a small plant room the operator can lose the '
      + 'way out.',
      'The powder is mildly corrosive and gets everywhere. Discharged over a switchboard or a server rack it will '
      + 'often cost more than the fire did — which is the argument for CO₂ in those rooms, not a safety prohibition.',
      'Invert and shake at the six-monthly to confirm the powder is still free-flowing. Powder that has packed will '
      + 'not discharge whatever the gauge says.',
    ],
    sourceIds: ['as1841-series', 'alexon-types', 'essentialfire-types'],
  },

  'dry-chemical-be': {
    type: 'dry-chemical-be',
    label: 'Dry chemical powder — BE',
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
          'BE powder does not carry a Class A rating. It knocks flame down without forming the crust that holds a '
          + 'deep-seated fire in ordinary combustibles, so the fire comes back. This is the difference from ABE and it '
          + 'is invisible on the cylinder — both carry a white band.',
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
        consequence:
          'Some overseas guidance credits bicarbonate powder with saponifying cooking oil. The Australian trade source '
          + 'reached does not, and a Class F risk is served by wet chemical. Treat BE as prohibited on Class F: the '
          + 'splash risk is the same as ABE and the cooling is no better.',
        confidence: 'low',
        sourceIds: ['essentialfire-types'],
        dispute:
          'Overseas material sometimes rates bicarbonate powder for cooking oil. No Australian source reached does. '
          + 'The conservative reading is used and this is why.',
      },
    ],
    handlingCautions: [
      'ABE and BE wear the same white band. If the register or the tag does not say which, read the label — the '
      + 'difference is a whole fire class.',
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
          'CO₂ smothers but does not wet or cool. A deep-seated fire in paper or timber reignites behind it once the '
          + 'gas disperses, which outdoors or in a draught is almost immediately.',
        confidence: 'high',
        sourceIds: ['alexon-types', 'essentialfire-types'],
      },
      { fireClass: 'B', suitability: 'rated', confidence: 'high', sourceIds: ['alexon-types', 'essentialfire-types'] },
      { ...CLASS_C_CONDITIONAL, sourceIds: ['essentialfire-types'] },
      CLASS_D_PROHIBITED(['essentialfire-types']),
      {
        fireClass: 'E',
        suitability: 'rated',
        consequence:
          'Non-conductive and leaves no residue, which is why it is the extinguisher for switchrooms, comms rooms and '
          + 'laboratories where powder would write off the equipment.',
        confidence: 'high',
        sourceIds: ['alexon-types', 'essentialfire-types'],
      },
      {
        fireClass: 'F',
        suitability: 'prohibited',
        consequence:
          'The discharge velocity blows burning oil straight out of the vat, and CO₂ does nothing to cool oil that is '
          + 'above its auto-ignition temperature. A CO₂ unit mounted in a kitchen is a defect to be raised, not a '
          + 'preference to be noted.',
        confidence: 'high',
        sourceIds: ['alexon-types', 'essentialfire-types'],
      },
    ],
    handlingCautions: [
      'No pressure gauge. A CO₂ extinguisher is only proved full by weighing it — the six-monthly gauge check that '
      + 'covers every other type does not exist on this one.',
      'The horn reaches cryogenic temperatures in use. Hold the handle, not the horn.',
      'Discharged in a small closed room it displaces the air. Get out with it.',
      'High-pressure cylinder. Any body damage, thread damage or corrosion on a CO₂ extinguisher is a more serious '
      + 'finding than the same damage on a stored-pressure unit.',
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
        dispute:
          'One trade source rates wet chemical for Class A as well as F; the other lists it for Class F only. Rely on '
          + "the rating printed on the extinguisher's own label, which is what the fire load was assessed against.",
      },
      {
        fireClass: 'B',
        suitability: 'unrated',
        consequence:
          'Rated for cooking oils and fats, which is not the same thing as flammable liquids generally. Do not treat a '
          + 'kitchen unit as covering the solvent store.',
        confidence: 'medium',
        sourceIds: ['essentialfire-types'],
      },
      { ...CLASS_C_CONDITIONAL, sourceIds: ['essentialfire-types'] },
      CLASS_D_PROHIBITED(['essentialfire-types']),
      {
        fireClass: 'E',
        suitability: 'prohibited',
        consequence:
          'The agent is a salt solution and conducts. In a commercial kitchen the fryer, the griddle and the power to '
          + 'both are within arm’s reach of each other, so this prohibition is a live one: isolate before use.',
        confidence: 'high',
        sourceIds: ['alexon-types', 'essentialfire-types'],
      },
      {
        fireClass: 'F',
        suitability: 'rated',
        consequence:
          'The only agent in this list rated for cooking oils. It saponifies the surface into a soap layer and cools '
          + 'below auto-ignition — which is why the discharge is a gentle spray and must not be rushed.',
        confidence: 'high',
        sourceIds: ['alexon-types', 'essentialfire-types'],
      },
    ],
    handlingCautions: [
      'Applied as a slow spray, not a jet. Discharged like a powder unit it splashes the oil it is supposed to be '
      + 'blanketing.',
      'A kitchen with a Class F risk and no wet chemical unit is a selection defect, whatever else is on the wall.',
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
        dispute:
          'Neither trade source reached covers vaporising liquid extinguishers. The ratings here follow the general '
          + "clean-agent case and must be replaced with the rating printed on the unit's own label before they are "
          + 'used on a document.',
      },
      { fireClass: 'B', suitability: 'rated', confidence: 'low', sourceIds: ['as1841-series'] },
      { ...CLASS_C_CONDITIONAL, sourceIds: ['as1841-series'] },
      CLASS_D_PROHIBITED(['as1841-series']),
      { fireClass: 'E', suitability: 'rated', confidence: 'low', sourceIds: ['as1841-series'] },
      {
        fireClass: 'F',
        suitability: 'prohibited',
        consequence:
          'A gaseous agent does not cool oil that is above its auto-ignition temperature. Same failure as CO₂: it goes '
          + 'out and then it comes back.',
        confidence: 'medium',
        sourceIds: ['as1841-series'],
      },
    ],
    handlingCautions: [
      'Clean agents differ from each other. Read the label rather than assuming a rating from the yellow band, and '
      + 'record the agent name on the asset — a refill has to match it.',
      'Not halon. If the label says BCF, halon 1211 or halon 1301, classify it as halon and stop.',
    ],
    sourceIds: ['as1841-series'],
  },

  halon: {
    type: 'halon',
    label: 'Halon (BCF) — withdrawn',
    shortLabel: 'Halon',
    agent: 'Halon 1211 (BCF) or halon 1301 — an ozone depleting substance',
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
        'Halon has not been lawful to own or use in Australia since 1995 except under an approved essential use, such '
        + 'as on board aircraft. A halon extinguisher found on a commercial building is surrendered to the National '
        + 'Halon Bank, not serviced and not condemned as scrap. Surrender has been free of charge since 1 January '
        + '2023. Treat this as a legal obligation on the owner, and say so in writing.',
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
      reason: `This app holds no position on ${profile.label} against ${FIRE_CLASS_LABEL[fireClass]}.`,
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
      whatToDo:
        'One row per extinguisher. Split the row, or read the label and record the one agent this asset actually '
        + 'holds.',
      sourceIds: ['as1841-series'],
    };
  }

  if (distinct.length === 1) return hits.find((h) => h.type === distinct[0])!;

  if (AMBIGUOUS_POWDER.test(raw)) {
    return {
      known: false,
      code: 'type-cell-ambiguous-powder',
      reason:
        `"${raw}" says powder without saying whether it is ABE or BE. The two carry the same white band and differ on `
        + 'Class A, so this cannot be settled from the cell.',
      whatToDo: 'Read the label at the next attendance. Until then treat the asset as unclassified, not as ABE.',
      sourceIds: ['essentialfire-types'],
    };
  }

  return {
    known: false,
    code: 'type-cell-unrecognised',
    reason: `"${raw}" does not name an extinguisher type this app recognises.`,
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
  'Weighed to establish it is fully charged — the only check there is on a unit with no gauge.',
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
        'The six-monthly inspection, plus the additional yearly items for this type.',
        'Which extra items fall at the yearly rather than the six-monthly is not established in this app. Work the '
        + 'yearly from the purchased copy of Section 10 and not from this list.',
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
        'Sources disagree. Guidance describing AS 1851 Section 10 puts every portable extinguisher on a five-yearly '
        + 'test; an Australian contractor reached puts CO₂ on a ten-yearly test while leaving every other portable on '
        + 'five. Neither source names the clause or the cylinder standard the ten years would come from, so no '
        + 'standard designation is asserted for it here. Five years is used because it is the shorter, not because '
        + 'the ten-year reading has been disproved. Settle it against the purchased copy before quoting a client '
        + 'either way.',
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
      note:
        'Academic. A halon extinguisher is not pressure tested and returned to service — it is surrendered to the '
        + 'National Halon Bank.',
    };
  }
  return {
    intervalMonths: 60,
    anchor: 'date-of-manufacture',
    confidence: 'medium',
    sourceIds: ['as1851-s10', 'fpa-servicing', 'firewize-5yr'],
    note:
      'Discharged, stripped, tested and recharged on the anniversary of manufacture. The industry body notes there '
      + '"may be other servicing requirements at 3, 5 or 6 years"; this app does not know what those are and does not '
      + 'invent them.',
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
      'This asset is in an adverse environment. AS 1851-2012 sets a separate regime for equipment in aggressive '
      + 'environments at clause 1.13, and servicing frequency increases. By how much is not established in this app, '
      + 'so the intervals shown have NOT been shortened. Set the frequency from the purchased copy and record why.',
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
  const today = input.today.slice(0, 10);
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
      whatToDo:
        'This is a fault in the app, not in the register. Report it — the interval and the schedule frequency for '
        + 'this activity have to be the same length.',
      sourceIds,
    };
  }

  const manufactured = toSpan(input.manufactured);
  const lastDone = toSpan(input.lastDone);

  if (!manufactured && !lastDone) {
    return {
      known: false,
      code: 'no-anchor-date',
      reason:
        `Neither a date of manufacture nor a record of the last ${ACTIVITY_LABEL[input.activity].toLowerCase()} is `
        + 'readable, so there is nothing to count from.',
      whatToDo:
        'Read the date stamped on the cylinder at the next attendance. Every extinguisher carries one, and it is the '
        + 'anchor this schedule is supposed to run from.',
      sourceIds: ['as1841-series', 'firewize-5yr'],
    };
  }

  if (manufactured && manufactured.earliest > today) {
    return {
      known: false,
      code: 'manufacture-in-future',
      reason: `The date of manufacture reads ${manufactured.label}, which is in the future.`,
      whatToDo:
        'Re-read the stamp. A two-digit year read as the wrong century is the usual cause, and the register needs '
        + 'correcting at the source system rather than here.',
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
      reason:
        `The last ${ACTIVITY_LABEL[input.activity].toLowerCase()} reads ${lastDone.label}, which has not happened `
        + 'yet.',
      whatToDo:
        'Correct the date in the source system. Until it is corrected this asset has no schedule — a service dated '
        + 'in the future counts an occurrence nobody carried out.',
      sourceIds: ['as1841-series'],
    };
  }

  if (manufactured && lastDone && lastDone.latest < manufactured.earliest) {
    return {
      known: false,
      code: 'service-before-manufacture',
      reason:
        `The last ${ACTIVITY_LABEL[input.activity].toLowerCase()} reads ${lastDone.label}, which is before the date of `
        + `manufacture of ${manufactured.label}.`,
      whatToDo:
        'One of the two dates is wrong. Do not schedule from either until the register is corrected — an asset '
        + 'scheduled off a bad anchor reads as compliant for years.',
      sourceIds: ['as1841-series'],
    };
  }

  const anchor = manufactured ?? lastDone!;
  const anchoredTo = manufactured ? 'date-of-manufacture' : 'last-service';

  if (anchoredTo === 'last-service') {
    notes.push(
      'No date of manufacture was readable, so this is counted forward from the last service. Any lateness already in '
      + 'the record is carried forward with it, which is exactly the drift the anchor rule exists to prevent. Read the '
      + 'stamp off the cylinder and re-assess.',
    );
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
    notes.push(
      `${missedOccurrences} occurrences of this activity have fallen due since the last recorded one. The date shown `
      + 'is the oldest one still outstanding, not the most recent.',
    );
  }
  if (notCredited && lastDone) {
    notes.push(
      `The last one recorded, ${lastDone.label}, sits between scheduled dates — ${notCredited.months} months before `
      + `occurrence ${notCredited.occurrence}, which is more than a quarter of the interval. It has not been counted `
      + 'as that occurrence, so that occurrence is still outstanding. Under the anchor rule a service done well '
      + 'before a scheduled date does not satisfy it.',
    );
  }
  if (earlyCredit && lastDone) {
    notes.push(
      `The last one recorded, ${lastDone.label}, was ${earlyCredit.months} month`
      + `${earlyCredit.months === 1 ? '' : 's'} before occurrence ${earlyCredit.occurrence} fell due and has been `
      + 'counted as it. No tolerance window is being asserted by that — it is close enough to the date that reading '
      + 'it as the next one instead would report a service that never happened.',
    );
  }
  if (due.precision !== 'day') {
    notes.push(
      `The anchor was recorded as "${anchor.raw}" — ${anchor.precision === 'month' ? 'a month' : 'a year'} with no `
      + `day — so the next one is due within ${due.label} rather than on a particular date. No day has been invented.`,
    );
  }
  notes.push(
    'No tolerance window has been applied. The AS 1851 Section 6 tolerances this app holds are for detection and '
    + 'alarm systems; what Section 10 allows on an extinguisher is not established here, so none is assumed.',
  );
  if (spec.dispute) notes.push(spec.dispute);

  return {
    activity: input.activity,
    intervalMonths: spec.intervalMonths,
    anchoredTo,
    anchorNote:
      anchoredTo === 'date-of-manufacture'
        ? `Counted from the date of manufacture, ${anchor.label}. Occurrence ${nextOccurrence} since manufacture.`
        : `Counted from the last service, ${anchor.label}, because no date of manufacture was readable.`,
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
      'Do not discharge and do not refill. Remove from service and surrender the unit to the National Halon Bank — '
      + 'free of charge since 1 January 2023 — and put the obligation to the owner in writing.',
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
      'Surface rust on a coastal site is cosmetic; pitting that has taken metal out of the wall is a condemnation. '
      + 'Which one this is depends on depth, extent and where on the body it sits, and none of that reaches this app '
      + 'from a checkbox.',
    action:
      'The technician on site decides, and records the decision with a photograph. If it is close, it goes to the '
      + 'five-yearly strip where the inside can be seen, not back on the wall.',
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
    action: 'Decided on site, with a photograph. Where it is a CO₂ body and there is any doubt, condemn.',
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
      'An extinguisher nobody can identify cannot be selected, cannot be refilled with the right agent and cannot be '
      + 'used under stress by someone reading it for the first time. Sometimes the label is replaceable; sometimes the '
      + 'markings are stamped and gone.',
    action:
      'Replace the label if the markings can be established from the stamping. If the agent cannot be established at '
      + 'all, condemn — an unknown agent must not be discharged at an unknown fire.',
    confidence: 'medium',
    sourceIds: ['amsa-707', 'as1841-series'],
  },
  'no-date-of-manufacture': {
    id: 'no-date-of-manufacture',
    label: 'No readable date of manufacture',
    outcome: 'judgement',
    reason:
      'The date stamp is the anchor the five-yearly runs from. Without it there is no way to say whether the pressure '
      + 'test is due, and a schedule counted from the last service instead will drift.',
    action:
      'Search the base and the neck before concluding it is absent. If it genuinely is not there, the asset cannot be '
      + 'scheduled properly and should be replaced at the next five-yearly rather than tested indefinitely.',
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
    action:
      'Refill and reseal. The industry position is explicit that a partially discharged extinguisher is refilled '
      + 'between the five-yearly services, not topped up or left.',
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
    action: 'Strip, replace the powder charge and recharge. Look at the mounting — vibration is the usual cause.',
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
      statement:
        'No condition assessment was carried out on this asset, so nothing can be said about it. An absence of '
        + 'findings from an extinguisher nobody looked at is not a pass.',
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
      statement:
        `This app has no rule for ${unrecognised.map((u) => `"${u}"`).join(', ')}, so it cannot say whether the asset `
        + 'is serviceable. A person has to rule on it and the finding should be added to the rules.',
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
        `A person has to decide: ${needsJudgement.map((r) => r.label.toLowerCase()).join('; ')}. `
        + 'Until that decision is recorded the asset is neither condemned nor serviceable, and it must not be tagged '
        + 'as either.',
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
    statement:
      'Inspected, and nothing found that takes it out of service. This covers what a routine inspection can see; it '
      + 'is not a statement about the inside of the body, which is only seen at the five-yearly strip.',
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
  origin: 'manufacturer-plate' | 'app-held';
  confidence: Confidence;
  sourceIds: SourceId[];
  /** Why this figure should be treated carefully. Always present. */
  caveat: string;
}

/**
 * The permitted variation in charge mass, by type.
 *
 * This is deliberately almost empty, and the emptiness is the point. Weighing
 * an extinguisher is the check; the pass or fail is entirely a function of the
 * tolerance applied, and this app could not find that tolerance stated in any
 * Australian publication it can reach. The one figure that exists here — ten
 * per cent of the charge for carbon dioxide — comes from a North American
 * service manual written to NFPA 10, and it is carried with that fact attached
 * rather than dressed up as AS 1851.
 *
 * Everything else returns nothing, and checkCharge refuses instead of guessing.
 * The right answer on site is the tolerance printed on the extinguisher's own
 * label or plate, which the caller can pass in.
 */
export const CHARGE_TOLERANCE: Partial<Record<ExtinguisherType, ChargeTolerance>> = {
  'carbon-dioxide': {
    percentOfCharge: 10,
    origin: 'app-held',
    confidence: 'low',
    sourceIds: ['nfpa10-co2-charge'],
    caveat:
      'Not an Australian figure. It comes from a North American service manual written to NFPA 10, and is offered '
      + 'only because a CO₂ extinguisher has no gauge and weighing is the only check there is. The tolerance on the '
      + "unit's own plate governs; where the plate states one, pass it in.",
  },
};

export function chargeTolerance(
  type: ExtinguisherType,
  manufacturerPercent?: number,
): ChargeTolerance | Refused {
  if (manufacturerPercent !== undefined) {
    if (!Number.isFinite(manufacturerPercent) || manufacturerPercent <= 0 || manufacturerPercent >= 100) {
      return {
        known: false,
        code: 'tolerance-not-a-percentage',
        reason: `A tolerance of ${manufacturerPercent}% is not a usable figure.`,
        whatToDo: 'Re-read the plate. The tolerance is a small percentage of the charge, not of the gross mass.',
        sourceIds: ['as1851-s10'],
      };
    }
    return {
      percentOfCharge: manufacturerPercent,
      origin: 'manufacturer-plate',
      confidence: 'high',
      sourceIds: [],
      caveat:
        "Taken from the manufacturer's own marking on this extinguisher, which is the figure that governs. It is a "
        + 'reading off the asset and not a published figure, so no document is cited for it — record the plate in the '
        + 'photographs instead.',
    };
  }
  const known = CHARGE_TOLERANCE[type];
  if (known) return known;
  return {
    known: false,
    code: 'no-charge-tolerance',
    reason:
      `This app holds no charge tolerance for ${PROFILES[type].label}, and will not borrow one from another type. A `
      + 'few hundred grams either way decides whether an extinguisher goes back on a wall.',
    whatToDo:
      "Read the permitted variation off the extinguisher's own label or plate and pass it in. Failing that, check the "
      + 'gauge and refer the weight to the five-yearly strip.',
    sourceIds: ['as1851-s10', 'fpa-servicing'],
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
  /** Whether the tolerance is the app's own held figure or this asset's plate. */
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
 * expected charge to compare against, a type this app has no tolerance for, and
 * a tolerance figure that is not a percentage.
 */
export function checkCharge(input: ChargeInput): ChargeCheck | Refused {
  const { type, tareGrams, grossGrams } = input;

  const missingMass = (n: unknown) => typeof n !== 'number' || !Number.isFinite(n) || n < 0;
  if (missingMass(tareGrams) || missingMass(grossGrams)) {
    return {
      known: false,
      code: 'mass-not-read',
      reason: 'The tare or gross mass is missing or is not a mass.',
      whatToDo:
        'Read the tare off the cylinder stamping and weigh the extinguisher. Both in grams — a kilogram figure '
        + 'entered here reads as a very light extinguisher.',
      sourceIds: ['amsa-707'],
    };
  }

  if (!isWholeGrams(tareGrams) || !isWholeGrams(grossGrams)) {
    return {
      known: false,
      code: 'mass-not-whole-grams',
      reason:
        `A mass of ${!isWholeGrams(tareGrams) ? tareGrams : grossGrams} g is not a whole number of grams, and this `
        + 'check works in whole grams so that a subtraction never turns into a float.',
      whatToDo:
        'Enter both masses as whole grams. A decimal here is almost always kilograms in a grams field — 3.5 is three '
        + 'and a half grams, not a 3.5 kg extinguisher.',
      sourceIds: ['amsa-707'],
    };
  }

  if (grossGrams <= tareGrams) {
    return {
      known: false,
      code: 'gross-at-or-below-tare',
      reason:
        `The extinguisher weighs ${grossGrams} g and its stamped empty mass is ${tareGrams} g, so it appears to hold `
        + 'no agent at all.',
      whatToDo:
        'One of the two figures is wrong — usually a tare read off the wrong stamping, or a scale still in kilograms. '
        + 'Check both before writing anything down. If the reading is real the extinguisher is empty, which is a '
        + 'defect and not a weight check.',
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
      reason:
        `The charge to compare against works out at ${expected} g, which is not a whole number of grams. The label `
        + 'figure it came from is in the wrong unit or has been mistyped.',
      whatToDo: "Re-read the nominal charge or the full gross mass off the label and enter it as whole grams.",
      sourceIds: ['amsa-707'],
    };
  }

  if (expected === undefined || !isWholeGrams(expected) || expected <= 0) {
    return {
      known: false,
      code: 'no-expected-charge',
      reason: 'There is nothing to compare the weight against — no nominal charge and no labelled full gross mass.',
      whatToDo:
        "Read the charge or the full gross mass off the extinguisher's label. Without one of them a weight is a "
        + 'number, not a check.',
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
      ? `Holding ${actual} g against ${expected} g nominal, ${differencePercent > 0 ? '+' : ''}${differencePercent}% — `
        + `within the ±${tolerance.percentOfCharge}% applied.`
      : state === 'undercharged'
        ? `Short by ${Math.abs(difference)} g, ${Math.abs(differencePercent)}% of the nominal charge, against a `
          + `±${tolerance.percentOfCharge}% allowance. The extinguisher has lost agent and must be recharged.`
        : `Heavier than nominal by ${difference} g, ${differencePercent}% of the charge, against a `
          + `±${tolerance.percentOfCharge}% allowance. Overcharging is not a harmless error — check the tare stamping `
          + 'and what the unit was last filled with.';

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
  const today = todayIso.slice(0, 10);
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
  'Queensland licenses portable fire equipment work by class through the QBCC, and is the only state that licenses '
  + 'extinguisher technicians at all. The class held has to cover the work actually done — a certify class does not '
  + 'authorise inspect and test — and the licence number goes on the record of maintenance.';

export const QLD_LICENSING_SOURCE: SourceId[] = ['qbcc-portable', 'fpa-servicing'];
