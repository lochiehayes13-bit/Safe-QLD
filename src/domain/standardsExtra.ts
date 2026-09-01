/**
 * The rest of the standards catalogue, and the Queensland legislation layer.
 *
 * `standardsCatalogue.ts` is a register of clause numbers and titles read out of
 * the documents themselves. That is honest but thin: a clause number with no
 * explanation tells a technician standing in a plant room nothing about whether
 * the clause is the one they want. This module is the explanations — written
 * here, in our own words, saying what each clause is FOR and when someone
 * reaches for it — plus the Queensland statute that turns all of it into a legal
 * obligation.
 *
 * Two rules shape everything below and neither is negotiable.
 *
 * **Australian Standards are not reproduced.** Not their wording, not their
 * tables, not their numeric thresholds. Clause numbers are facts and ship; the
 * text is licensed per copy and stays in the technician's own copy on the
 * device. So a description here says *"the sound pressure level the warning
 * signal has to reach"* and never what that level is. If a note ever reads like
 * it was transcribed, it is a bug.
 *
 * **Queensland legislation is different.** The Building Fire Safety Regulation
 * 2008 is Crown material published free and made to be used, so the sections
 * that carry the obligation are reproduced faithfully, word for word, with the
 * official source recorded next to them. Getting s.49 slightly wrong is how a
 * technician either misses a critical defect notice or serves one that was never
 * owed.
 *
 * **Where the source did not tell us, there is no entry.** A clause listed in
 * the catalogue with no note here is a clause nobody has written up, and the
 * library says exactly that rather than inventing a plausible summary. The same
 * goes for the two superseded editions of AS 1670.4 — their clause titles are in
 * the catalogue and their bodies were not read, so nothing is claimed about
 * them. Guessing what a clause covers is worse than saying nothing, because a
 * guess gets cited on a service record.
 *
 * Nothing here is imported by the database layer, so it loads in a test.
 */

import type { StandardDoc } from '@/domain/standardsCatalogue';

// ---------------------------------------------------------------------------
// Clause notes
// ---------------------------------------------------------------------------

export type NoteConfidence = 'high' | 'medium' | 'low';

/** A curated description of one clause, for merging into the catalogue. */
export interface ClauseNote {
  /** What the clause governs and when a technician reaches for it. Our words. */
  covers: string;
  /** The app route that implements or checks it, where one exists. */
  appFeature?: string;
  /**
   * Set only where this note is worth less than its document's default — a
   * clause read around rather than read, typically because the extracted text
   * lost a figure or a table the clause turns on.
   */
  confidence?: NoteConfidence;
}

export interface NoteProvenance {
  /** Where the reading came from. Named per document, not per note. */
  source: string;
  /** What that source is worth, absent a per-note override. */
  confidence: NoteConfidence;
}

/**
 * Where the notes for each document came from.
 *
 * Every note is a reading of the document's own clause body from Safe QLD's
 * licensed copy. Recording it per document rather than per note keeps the
 * source in the data — a caller can always ask what a description is worth —
 * without a thousand repetitions of the same sentence.
 */
export const NOTE_SOURCES: Record<string, NoteProvenance> = {
  'as-2419-1-2005': {
    source: "Read from Safe QLD's licensed copy of AS 2419.1:2005, clause bodies of Sections 1 to 10.",
    confidence: 'high',
  },
  'as-1670-1-2004': {
    source: "Read from Safe QLD's licensed copy of AS 1670.1:2004 (incl. Amdt 1:2005), clause bodies of Sections 1 to 7.",
    confidence: 'high',
  },
  'as-1670-4-2018': {
    source: "Read from Safe QLD's licensed copy of AS 1670.4:2018, clause bodies of Sections 1 to 5.",
    confidence: 'high',
  },
  'as-2293-set-2005': {
    source: "Read from Safe QLD's licensed copy of the AS 2293 Set:2005, being AS 2293.1:2005 clause bodies of Sections 1 to 8.",
    confidence: 'high',
  },
  'as-2293-3-2005': {
    source: "Read from Safe QLD's licensed copy of AS 2293.3:2005, clause bodies of Sections 1 to 4.",
    confidence: 'high',
  },
  'as-nzs-2293-2-1995': {
    source: "Read from Safe QLD's licensed copy of AS/NZS 2293.2:1995, clause bodies of Sections 1 to 3.",
    confidence: 'high',
  },
  'as-2444-2001': {
    source: "Read from Safe QLD's licensed copy of AS 2444:2001, clause bodies of Sections 1 to 6.",
    confidence: 'high',
  },
  'as-2441-2005': {
    source: "Read from Safe QLD's licensed copy of AS 2441:2005 (incl. Amdt 1:2009), clause bodies of Clauses 1 to 13.",
    confidence: 'high',
  },
  'as-1905-1-2005': {
    source: "Read from Safe QLD's licensed copy of AS 1905.1:2005, clause bodies of Sections 1, 2 and 4 to 6.",
    confidence: 'high',
  },
  'as-1851-2012': {
    source: "Read from Safe QLD's licensed copy of AS 1851:2012, confirmed section and table numbers only.",
    confidence: 'high',
  },
  'qdc-mp-6-1': {
    source: 'Queensland Development Code MP 6.1 (Crown material, published free), performance criteria P1 and P2 and Schedules 1 and 2.',
    confidence: 'high',
  },
};

/**
 * Curated clause descriptions, keyed `"<docId>|<clauseRef>"`.
 *
 * The key is the document id and the clause reference exactly as the catalogue
 * prints them, so a note can only ever attach to a clause that really exists.
 * Nothing here overwrites a description the catalogue already carries — see
 * `clauseNoteConflicts`, which the test uses to prove it.
 */
export const CLAUSE_NOTES: Record<string, ClauseNote> = {
  // -------------------------------------------------------------------------
  // AS 2419.1:2005 — Fire hydrant installations
  // -------------------------------------------------------------------------
  'as-2419-1-2005|1.4': {
    covers:
      'The vocabulary the rest of the document argues in — a feed hydrant against an attack hydrant, effective height, residual against working pressure, and what makes one hydrant the hydraulically most disadvantaged. A flow test report that uses these words loosely describes a different test from the one that was actually done.',
    appFeature: 'tools/hydrant',
  },
  'as-2419-1-2005|2.1': {
    covers:
      'The shape of the design before any figures: hydrants outside the building wherever they can be, internal hydrants only for what the external ones cannot reach, equipment matched to the brigade that attends, and hardstand wherever an appliance has to stand. It is the clause that explains why a hydrant is where it is.',
  },
  'as-2419-1-2005|3.1': {
    covers:
      'Opens the section that fixes where hydrants go and what has to stay clear around them. Almost every access or obstruction defect on a hydrant service traces back into this section rather than to any performance figure.',
  },
  'as-2419-1-2005|3.3': {
    covers:
      'Hydrant coverage for open yards — stockpiles, laydown and process areas rather than buildings. The number of outlets that must flow together is driven by the area of the yard, so a yard that has grown since installation can quietly outgrow the protection that was designed for it.',
    appFeature: 'tools/hydrant',
  },
  'as-2419-1-2005|3.4': {
    covers:
      'Hydrant protection for marinas, where coverage is measured out to the moored vessels rather than to a building envelope. Rare on the book, and the rules are not the building rules, so do not read across from the on-site hydrant location clause.',
  },
  'as-2419-1-2005|3.6': {
    covers:
      'Hydrant cabinets, enclosures and recesses: big enough to work in, doors that do not block an exit or another appliance, weatherproof outside, and containing firefighting equipment and nothing else. The cleaner’s broom in the hydrant cupboard is a defect against this clause.',
  },
  'as-2419-1-2005|4.1': {
    covers:
      'Which water sources may feed a hydrant system, and the prohibition on an in-line meter throttling it. Worth reading before writing up a tank, bore or river supply as non-compliant simply because it is not a town main.',
  },
  'as-2419-1-2005|4.2': {
    covers:
      'The minimum quantity of water the source has to hold, expressed as a duration at the required flow rather than as a tank size. This is the figure the four-hour supply argument turns on, and it is why an on-site tank may be smaller where the town main can top it up while the system runs.',
    appFeature: 'tools/hydrant',
  },
  'as-2419-1-2005|4.3': {
    covers:
      'When on-site storage is required at all, how its capacity is arrived at, and the requirement that a usable proportion of the volume stays available while the tank is being maintained. Reach for it when a tank is drained for cleaning and someone asks whether the building is impaired.',
    appFeature: 'work/impairments',
  },
  'as-2419-1-2005|5.1': {
    covers:
      'Opens the tank section. An on-site tank answers to this Standard, to the water agency and to the plumbing standard at the same time, which is why tank findings so often need a third party involved before they can be closed.',
  },
  'as-2419-1-2005|5.2': {
    covers:
      'How a tank is kept full — make-up supply, automatic inflow, the manual quick-fill facility the brigade uses, and how fast the tank has to recover. A quick-fill valve that will not open is a brigade-facing defect even on a tank that is full to the brim.',
  },
  'as-2419-1-2005|5.3': {
    covers:
      'Effective capacity: the water actually usable between the normal level and the level at which the pump starts drawing air, which is always less than the tank’s nameplate volume. Vortex inhibitors belong here too, and a missing one shrinks the usable volume without changing the label on the tank.',
  },
  'as-2419-1-2005|5.4': {
    covers:
      'Tank connections, valves and accessories — suction points the brigade’s own hose can couple to and park in front of, contents indication, tank signage, and access openings and ladders. This is the clause behind most "the tank is full but the brigade cannot draw from it" findings.',
  },
  'as-2419-1-2005|6.1': {
    covers:
      'Hydrant pumpsets are sized here and built and tested to the pumpset standard. Two documents, so a pump finding almost always needs both cited before anyone can act on it.',
  },
  'as-2419-1-2005|6.2': {
    covers:
      'The permitted pumpset configurations: how many pumps, what may drive each, and what counts as a genuinely independent power source. It answers whether a single-pump installation was ever allowed for this building or has quietly lost a pump along the way.',
  },
  'as-2419-1-2005|6.3': {
    covers:
      'Switches in the supply to an electric pump driver have to be locked on and labelled so nobody isolates the fire pump in good faith during other work. A missing or unreadable label here is a routine finding and a cheap one to fix.',
  },
  'as-2419-1-2005|6.4': {
    covers:
      'The pumproom itself — security, ventilation for aspiration and cooling, cold starting, signage the arriving brigade can find, fire separation from the building, and enough clear space to actually pull a pump out. Half the pumproom defects raised are this clause rather than anything about the pump.',
  },
  'as-2419-1-2005|7.1': {
    covers:
      'Opens the booster section and points the physical assembly at the booster-connection standard. Couplings have to match the brigade that attends, which in South East Queensland is not something to assume from a catalogue photograph.',
  },
  'as-2419-1-2005|7.3': {
    covers:
      'Where a booster may be sited: reachable by a pumping appliance, in sight of the main entrance or out at the boundary, fire-separated from the building where it is attached to it, clear of high voltage equipment and gas storage, and not screened by vegetation, stored goods or parked cars. The overgrown booster is the commonest defect this clause catches.',
    appFeature: 'tools/hydrant',
  },
  'as-2419-1-2005|7.4': {
    covers:
      'How the feed hydrants and booster inlets are arranged relative to each other — spacing, working height, and enough room that connected hoses do not foul one another. It is what makes a booster usable under pressure, at night, by someone wearing gloves.',
  },
  'as-2419-1-2005|7.5': {
    covers:
      'A booster connected in parallel with the on-site pumps: feed hydrants on the pump suction side, booster inlets downstream of the pump discharge. Which arrangement a site has decides which commissioning test applies, so identify it before booking the test rather than during it.',
    appFeature: 'site/form72',
  },
  'as-2419-1-2005|7.6': {
    covers:
      'A booster connected in series (relay) with the on-site pumps, with its full-flow bypass, its own gauge at the booster, and the warning sign telling the pump operator what that gauge is really reading. A series booster can over-pressure the system, which is why it attracts an extra commissioning test the parallel arrangement does not.',
    appFeature: 'site/form72',
  },
  'as-2419-1-2005|7.7': {
    covers:
      'Brigade relay pumps in very tall buildings, staged so each pressure stage can be boosted in turn. Relevant on high-rise and irrelevant almost everywhere else, but worth recognising so a relay pumpset is not mistaken for a spare hydrant pump.',
  },
  'as-2419-1-2005|7.8': {
    covers:
      'The booster enclosure: sized for the equipment, easy to operate in, drained, and carrying the block plan. An enclosure that holds water or has no plan in it fails this clause even where every fitting inside it is sound.',
  },
  'as-2419-1-2005|7.10': {
    covers:
      'Booster signage — the notice giving boost and test pressure so an operator knows what to boost to, and the identification on the door telling the brigade whether they are looking at a hydrant booster, a sprinkler booster or both. A faded pressure sign leaves a pump operator guessing at a live incident.',
    appFeature: 'tools/hydrant',
  },
  'as-2419-1-2005|8.1': {
    covers:
      'What the pipework is allowed to be, by pressure rating and setting, before anything about how it is joined or held up. The starting point when identifying unknown existing pipework during an upgrade.',
  },
  'as-2419-1-2005|8.2': {
    covers:
      'Which pipe and fitting specifications are acceptable above ground, below ground and for light steel, and what the limitations are on each. Read alongside the joints clause when assessing an old installation nobody has records for.',
  },
  'as-2419-1-2005|8.3': {
    covers:
      'How metal pipe joints may be made — grooved, shouldered, compression, gasketed, brazed — and where each is permitted. Below-ground joints carry their own restrictions, which is where most retrofits come unstuck.',
  },
  'as-2419-1-2005|8.5': {
    covers:
      'Pipework design: minimum main sizes, ring mains and their design criteria, where isolating valves go and which of them have to be monitored, pressure-reducing valve stations, and the system test facility. When a valve is found shut, this is the clause that says whether anyone should have known.',
    appFeature: 'work/impairments',
  },
  'as-2419-1-2005|8.6': {
    covers:
      'Physical and corrosion protection of the main and how it is marked and identified along its length. An unmarked fire main in a plant room full of other services is a genuine hazard during a shutdown, not a cosmetic finding.',
  },
  'as-2419-1-2005|8.7': {
    covers:
      'Support of hydrant pipework — hanger and bracket types, the materials they may be made from, the fire rating the supports themselves need, and how far apart they may be. A support that fails in a fire drops a charged main onto whatever is under it.',
  },
  'as-2419-1-2005|8.8': {
    covers:
      'Thrust blocks and anchors on unrestrained joints, taking the reaction that pressure, water hammer and ground movement put into a buried main. A joint that blows shortly after a flow test usually leads back here.',
  },
  'as-2419-1-2005|9.1': {
    covers:
      'Opens the ancillary equipment section on a single principle: hose, gauges and backflow devices all have to survive the weather in the position they are actually fitted, not the position they were specified for.',
  },
  'as-2419-1-2005|9.2': {
    covers:
      'Hose provided at a hydrant — how it is stored so it can be deployed rather than untangled, and the hose standard it answers to. Fittings have to suit the attending brigade rather than the last contractor’s van stock.',
  },
  'as-2419-1-2005|9.4': {
    covers:
      'Backflow prevention where the water agency requires it, and where it sits relative to the feed hydrants and booster inlets so it does not steal pressure from the appliance. A device in the wrong place changes what a flow test reads, which is worth knowing before blaming the main.',
  },
  'as-2419-1-2005|10.1': {
    covers:
      'Opens the commissioning section, and says plainly that a system failing any of these tests is investigated, rectified and retested rather than recorded with a note. It also anticipates the tests recurring whenever the regulator asks, which in Queensland is what Form 72 is.',
    appFeature: 'site/form72',
  },
  'as-2419-1-2005|10.2': {
    covers:
      'Hydrostatic testing at commissioning: vent and flush first, then hold pressure referenced to the highest outlet, and test buried or concealed pipework before anything is covered over. Part B of Queensland Form 72 records exactly this result.',
    appFeature: 'site/form72',
  },
  'as-2419-1-2005|10.3': {
    covers:
      'The commissioning flow test proper — prove water at every hydrant, then flow the required number of most disadvantaged hydrants simultaneously and measure against the design tables, including the zero-flow condition on each pump. This is the test a hydrant flow certificate is reporting.',
    appFeature: 'tools/hydrant',
  },
  'as-2419-1-2005|10.6': {
    covers:
      'The extra commissioning test where the system includes a tank the brigade can draw from, boosting off the tank rather than off the town main. Easy to skip on a site with both, and it is the harder of the two conditions.',
    appFeature: 'site/form72',
  },
  'as-2419-1-2005|10.7': {
    covers:
      'What the record of commissioning has to state and the requirement that it stays on the property. It is the ancestor of the Queensland Form 72 and of every later maintenance record, which is why a site with no original record can only be visited honestly, not serviced against a benchmark.',
    appFeature: 'site/form72',
  },

  // -------------------------------------------------------------------------
  // AS 1670.1:2004 — Fire detection and alarm, design and installation
  // -------------------------------------------------------------------------
  'as-1670-1-2004|1.4': {
    covers:
      'The definitions the whole design is argued in — alarm zone, protected area, actuating device, control and indicating equipment, designated entry point. A dispute about whether something counts as "one zone" is nearly always a dispute about this clause rather than about the panel.',
  },
  'as-1670-1-2004|1.5': {
    covers:
      'How the limiting values elsewhere in the document are to be read, which decides whether a measurement landing exactly on a stated figure passes or fails. Settle this before arguing a borderline spacing with a certifier.',
  },
  'as-1670-1-2004|2.1': {
    covers:
      'What a complying system is made of, and the requirement that every component is listed to its own product standard and proven compatible in the combination actually installed. A detector fitted to a panel it has never been listed with is a non-conformance that no functional test will ever reveal.',
    appFeature: 'work/baselines',
  },
  'as-1670-1-2004|2.2': {
    covers:
      'Keeps the fire system independent of building management: the panel may report to a BMS, but a BMS fault or request must never inhibit it, and alarms must be indicated independently of it. This is the clause behind "the BMS shows it, so the panel does not need to".',
  },
  'as-1670-1-2004|2.3': {
    covers:
      'The designated building and site entry points — where the brigade arrives, and what has to tell them which building on the site is in alarm. On a multi-building campus this drives the plan at the gate as much as anything at the panel.',
  },
  'as-1670-1-2004|2.4': {
    covers:
      'Alarm zone limitations: how much floor area, how long a run, how many storeys and how many devices a single zone may carry, and how mezzanines and concealed spaces are counted. When an imported panel configuration is checked against the building, this is what it is checked against.',
    appFeature: 'site/zones',
  },
  'as-1670-1-2004|2.5': {
    covers:
      'Addressable loop rules — what has to register as a fault, how many devices one fault may take out, when a loop needs two separate cable paths, and the ceiling on devices per loop. Reach for it when a loop has quietly grown past what it was designed to carry.',
    appFeature: 'site/points',
  },
  'as-1670-1-2004|2.6': {
    covers:
      'Distributed systems built from sub-indicator panels: how a SIP connects back to the fire indicator panel, what has to be monitored, how its events clear, and when duplicated signal paths become mandatory.',
  },
  'as-1670-1-2004|3.1': {
    covers:
      'The general installation rule — equipment goes where its performance will not be prejudiced and where it can actually be serviced. A detector installed where nobody can reach it is a finding under this clause before it is anything else.',
    appFeature: 'site/coverage',
  },
  'as-1670-1-2004|3.2': {
    covers:
      'The alarm acknowledgment facility in a residential sole occupancy unit, which gives an occupant a short window to clear a burnt-toast alarm before it goes further. It cannot be combined with alarm verification and cannot be used with heat detectors, which is the trap.',
  },
  'as-1670-1-2004|3.4': {
    covers:
      'Alterations to an existing installation: redesign, retest, recalculate the power supply, and revise both the documentation and the zone block plan. Most block plans found wrong on site are wrong because this clause was skipped after a fitout.',
    appFeature: 'site/zones',
  },
  'as-1670-1-2004|3.5': {
    covers:
      'Installing a multi-point aspirating detector — pipe runs and sampling point orientation set so the system can actually be maintained and so its performance holds up over years rather than only at commissioning.',
    appFeature: 'tools/vesda',
  },
  'as-1670-1-2004|3.6': {
    covers:
      'Control of ancillary devices: the circuits that drive fans, doors and suppression have to be isolated or protected so a fault on external wiring cannot stop the panel transmitting an alarm, and a suppression release circuit is supervised on top of that.',
    appFeature: 'site/cause-effect',
  },
  'as-1670-1-2004|3.7': {
    covers:
      'Every detector must show its own alarm — by an integral indicator, a remote indicator, or individual indication at the panel. It is what lets a technician walk to the head that operated instead of walking the whole zone.',
  },
  'as-1670-1-2004|3.11': {
    covers:
      'Labelling at the panel where CO fire detectors are installed, because they behave differently in alarm and are serviced strictly to the manufacturer’s instructions rather than the usual routine. A missing label sends the next technician down the wrong path entirely.',
  },
  'as-1670-1-2004|3.12': {
    covers:
      'How a fire suppression system reports to the panel: as its own alarm zone, on a protected signal path. Relevant every time a kitchen or gas suppression system is added to an existing panel and someone offers to share a spare zone.',
    appFeature: 'site/cause-effect',
  },
  'as-1670-1-2004|3.13': {
    covers:
      'Flow and pressure switches from a water-based system come into the panel as their own alarm zones with supervised wiring. It is why a sprinkler flow switch never shares a zone with detection, and why a surge on the main should be delayed rather than allowed to read as fire.',
  },
  'as-1670-1-2004|3.14': {
    covers:
      'Permits mixing device types on one alarm zone circuit provided they are compatible — the clause that answers "can I put a heat on this smoke zone" without opening the panel manual.',
  },
  'as-1670-1-2004|3.15': {
    covers:
      'The manual call point in the main entrance area, and the rule that operating one must not extinguish a detector indication already lit. Reach for it when a building has detection throughout and no call point where the brigade comes in.',
  },
  'as-1670-1-2004|3.16': {
    covers:
      'Power sources: the primary supply, the standby battery, the rating the supply has to meet, and the capacity the battery has to satisfy including the de-rating that comes with discharging at the alarm rate. The battery calculator implements this arithmetic.',
    appFeature: 'tools/battery',
  },
  'as-1670-1-2004|3.17': {
    covers:
      'Remote indicators for detectors hidden in roofs, cupboards, concealed spaces and ducts, including the wording and the location descriptor on the label and where the indicator is mounted relative to the door. An unlabelled remote indicator is worse than none, because it points nowhere.',
  },
  'as-1670-1-2004|3.18': {
    covers:
      'Connection to a monitoring service provider, the protection required on the path to the carrier, and the deliberate exclusion of domestic-grade smoke alarms from anything that transmits to the fire dispatch centre.',
  },
  'as-1670-1-2004|3.19': {
    covers:
      'Detectors that release held-open smoke and fire doors: where they sit relative to the opening, the requirement that the doors close on alarm, and the labelled non-latching manual release that has to be reachable with the door open. This is the detection half of a fire door service.',
    appFeature: 'tools/fire-door',
  },
  'as-1670-1-2004|3.20': {
    covers:
      'Sub-indicator panels — which areas one may serve, and where it goes. A SIP serving a whole building is installed as though it were the fire indicator panel, which catches people out on staged campuses.',
  },
  'as-1670-1-2004|3.21': {
    covers:
      'Monitored valve indication has to be separate from fire alarm indication at the panel and carry its own output. It is the reason a shut valve should never present as a fire, and the reason an isolated valve can be tracked as an impairment.',
    appFeature: 'work/impairments',
  },
  'as-1670-1-2004|3.22': {
    covers:
      'Occupant warning: either a sound system to AS 1670.4 or sounders producing the evacuation signal, together with the sound pressure level the signal has to reach over the measured ambient, the ceiling it must not exceed, the higher level required at the bedhead where occupants sleep, and when visual and tactile signals have to be added. The SPL tool measures against this clause.',
    appFeature: 'tools/spl',
  },
  'as-1670-1-2004|3.23': {
    covers:
      'Wire-free alarm zone circuits, pointed at their own equipment standard. Uncommon but growing on retrofit work, and not a licence to install any radio product that will talk to the panel.',
  },
  'as-1670-1-2004|3.24': {
    covers:
      'Wiring of the detection system — segregation from other services, conductor and cable types, marking, terminations and joints. Most of what an inspector points at in a riser is this clause rather than anything in the panel.',
  },
  'as-1670-1-2004|3.25': {
    covers:
      'Where detectors may go: the ceiling and roof cases, egress paths, concealed spaces, ducts, and the structural features that break up the flow of heat and smoke a detector depends on. The spacing rules in Sections 4 and 5 sit on top of this clause rather than replacing it.',
  },
  'as-1670-1-2004|3.26': {
    covers:
      'The list of places a detector is genuinely not required — small air locks, low or inaccessible concealed spaces, open covered areas, water heater cupboards, small sanitary spaces, certain skylights, and areas covered by a complying sprinkler system. Read it before writing a device up as missing.',
    appFeature: 'site/coverage',
  },
  'as-1670-1-2004|3.27': {
    covers:
      'When a fire brigade panel is required and where it is installed. It applies where the control equipment itself does not give the brigade zone-by-zone indication they can read on arrival.',
  },
  'as-1670-1-2004|3.28': {
    covers:
      'Multi-sensor detectors, including what happens when the smoke element is disabled at the panel: the device then has to be treated as a heat detector for spacing purposes. A quiet trap on sites that disable smoke sensing to stop unwanted alarms and never revisit the coverage.',
    appFeature: 'site/coverage',
  },
  'as-1670-1-2004|4.1': {
    covers:
      'Spacing and location of point-type heat detectors, including how far the sensing element sits below the ceiling or roof and how spacing changes with the shape of the structure above. The heat-detector counterpart of the smoke spacing clause.',
  },
  'as-1670-1-2004|4.2': {
    covers:
      'Linear heat detection — how much area one circuit may be credited with, protection from mechanical damage, and the rule that stops one cable spanning zones in a way that hides where the alarm came from.',
  },
  'as-1670-1-2004|5.1': {
    covers:
      'Spacing and location of point-type smoke and CO detectors: the coverage each head is credited with, and the geometry that reduces it. The two sub-clauses argued about most on site — distance from walls and air supplies, and separation from lights and fans — live under this clause.',
  },
  'as-1670-1-2004|5.2': {
    covers:
      'Multi-point aspirating detection as a design rather than an installation: the sampling points have to add up to at least the sensitivity of the point detectors they replace, a significant loss of airflow has to be indicated at the panel, and one aspirating detector cannot cover more than a single alarm zone would.',
    appFeature: 'tools/vesda',
  },
  'as-1670-1-2004|6.1': {
    covers:
      'Where flame detectors go: an unobstructed field of view, and protection against the lens fouling between service visits. A flame detector staring at a stack of pallets is blind and reports as perfectly normal.',
  },
  'as-1670-1-2004|6.2': {
    covers:
      'Spacing of flame detectors to remove shadows and blind spots, including the extra heads needed to cover what large plant, aircraft or racking hides.',
  },
  'as-1670-1-2004|7.1': {
    covers:
      'The commissioning checklist for a new system, and for the parts of an existing one an alteration touched — equipment, installation, compatibility, zone limits and power sources, each checked rather than assumed from the design.',
    appFeature: 'work/baselines',
  },
  'as-1670-1-2004|7.2': {
    covers:
      'The documentation that has to be left at the panel: as-installed drawings with unique device numbering, the control equipment documentation, the commissioning report, the installer’s statement and the log. A site with none of this cannot be serviced to the Standard, only visited.',
    appFeature: 'work/baselines',
  },
  'as-1670-1-2004|7.3': {
    covers:
      'The system log and the commissioning data it carries forward — battery type and capacity, installation date and recommended replacement date, float voltage, quiescent and alarm currents, minimum operating voltage and the calculated minimum battery. Every later battery calculation starts from figures recorded here.',
    appFeature: 'tools/battery',
  },

  // -------------------------------------------------------------------------
  // AS 1670.4:2018 — Emergency warning and intercom systems
  // -------------------------------------------------------------------------
  'as-1670-4-2018|1.6': {
    covers:
      'How measurements in this Standard are taken and what tolerance applies, including that a device position is measured from the centre line of the device. It decides whether a speaker that is slightly out of position is actually out.',
  },
  'as-1670-4-2018|1.7.1': {
    covers:
      'The system design has to be documented for both installation and commissioning before anything goes in. A system with no design has nothing to be commissioned against, which is how "commissioned" ends up meaning "switched on".',
  },
  'as-1670-4-2018|1.7.2': {
    covers:
      'Baseline data — the record of what was installed and what it measured, including the reference sound pressure level for every loudspeaker path, the component list with service-life expiry dates, a cause and effect statement for each interface, and the as-built drawings. Every later service is compared against this, and where it is missing the app says so rather than inventing a benchmark.',
    appFeature: 'work/baselines',
  },
  'as-1670-4-2018|1.7.3': {
    covers:
      'Alterations to an existing EWIS, which have to be designed and recorded like new work. Adding speakers to a tenancy without revisiting the amplifier load and the baseline is the usual failure, and it only shows up years later at a discharge or intelligibility check.',
    appFeature: 'work/baselines',
  },
  'as-1670-4-2018|2.1.1': {
    covers:
      'The requirement that every EWIS component conforms to a component standard and is compatible in the configuration actually installed — not merely present and working on the day it was switched on.',
  },
  'as-1670-4-2018|2.1.2': {
    covers:
      'What an emergency warning system is made of: warning control and indicating equipment, manual call points, loudspeakers, visual alarm devices, and warning equipment for people with hearing impairment. Useful when deciding whether what is on a site is an EWS at all or just a paging system with a red box.',
  },
  'as-1670-4-2018|2.1.3': {
    covers:
      'What an emergency intercom system is made of — intercom control and indicating equipment and the warden intercom point handsets. The EIS and the EWS are separate systems that commonly share one cabinet, and they are serviced separately.',
  },
  'as-1670-4-2018|2.1.4': {
    covers:
      'Connectable devices such as graphics terminals and building management interfaces: the EWIS must not depend on them, their failure must not affect it, and they must not reach the higher access levels remotely. The clause to cite when someone wants the EWIS on the building network.',
  },
  'as-1670-4-2018|2.2': {
    covers:
      'Emergency zones are set by the system design rather than by a fixed area rule, unlike detection alarm zones. That is precisely why the emergency zone block plan and the baseline data are the only reliable record of what a zone actually is on this building.',
    appFeature: 'site/zones',
  },
  'as-1670-4-2018|2.3': {
    covers:
      'Networked control equipment — what one panel has to show about another, how quickly a fault has to appear, where a condition may be reset, and the requirement that the equipment protecting a building can stand alone without the equipment in another building.',
  },
  'as-1670-4-2018|2.4': {
    covers:
      'Distributed parts of the control equipment: a single transmission path fault between them must not block signals from the rest, and the failure of one part must not inhibit another. It is what a distributed system is tested against.',
  },
  'as-1670-4-2018|2.5': {
    covers:
      'The limit on what a single transmission path fault is allowed to take out — one warning area, one warden intercom point, one detection input, one zone indication. This is the clause that decides how a system has to be cabled, and it is what a fault-condition test is really proving.',
  },
  'as-1670-4-2018|3.1': {
    covers:
      'Components installed where their performance holds up and where they can be serviced, with the environmental rating of the control equipment sitting here too. A speaker in a car park washdown area is this clause before it is anything about sound.',
  },
  'as-1670-4-2018|3.2.1': {
    covers:
      'Transmission paths out to connectable devices are electrically isolated, fused or current-limited so a fault on someone else’s equipment cannot inhibit the panel or stop an alarm being transmitted.',
  },
  'as-1670-4-2018|3.2.2': {
    covers:
      'Each path to a connectable device is supervised for any fault that would prevent correct operation, and such a fault has to show audibly and visibly. It is what makes a disconnected graphics terminal a fault rather than a mystery.',
  },
  'as-1670-4-2018|3.3.1': {
    covers:
      'Where the emergency warning control equipment is located, which is fixed by where emergency personnel will look for it rather than by where there happened to be wall space.',
  },
  'as-1670-4-2018|3.3.2': {
    covers:
      'A door covering the control equipment has to be marked, must not keep a warden out, and must not muffle the equipment’s own sounder. A locked cupboard in front of an EWCIE is a defect even when the panel behind it is perfect.',
  },
  'as-1670-4-2018|3.3.3': {
    covers:
      'The clear personnel workspace in front of and beside the control equipment, so a warden can stand and operate it during an evacuation. Storage creeping into that space is an obstruction defect and one of the commonest raised on a monthly routine.',
    appFeature: 'tools/routines',
  },
  'as-1670-4-2018|3.3.4': {
    covers:
      'The area around the control equipment has to be free of ignition sources and stored combustibles, which rules out siting it in a store room or an electrical switch room however convenient that is.',
  },
  'as-1670-4-2018|3.3.5': {
    covers:
      'The emergency zone block plan at the warning panel: the zones, where the control equipment and warden intercom points are, a "you are here" marker, where the baseline data are kept, and the design criteria the system was built to. It may be combined with the detection zone block plan, which is why a single wrong plan can misdescribe two systems at once.',
    appFeature: 'site/zones',
  },
  'as-1670-4-2018|3.4.1': {
    covers:
      'Fire isolation of distributed parts of the control equipment and of input/output devices on fire-rated paths — a steel enclosure or a fire-isolated room, so the equipment survives long enough to still be useful during the fire it is warning about.',
  },
  'as-1670-4-2018|3.4.2': {
    covers:
      'Interface devices and isolation relays outside the main cabinet have to be enclosed and labelled, so the next technician knows the unmarked box above the ceiling tile belongs to the EWIS and is not spare.',
  },
  'as-1670-4-2018|3.5.1': {
    covers:
      'All parts of the EWIS run from power supply equipment conforming to its own standard, whether that supply is integral to the panel or sitting somewhere else in the building feeding an amplifier rack.',
  },
  'as-1670-4-2018|3.5.3': {
    covers:
      'The standby power source — stationary batteries listed as compatible with the control equipment, and protected for overload at the source where they sit outside the cabinet.',
    appFeature: 'tools/battery',
  },
  'as-1670-4-2018|3.5.4': {
    covers:
      'How the power supply rating is worked out: every internal and external load in both the quiescent and the emergency condition, including ancillary loads and fault and disablement indication. This is where a battery calculation that looks tidy goes wrong, by leaving loads out of the sum.',
    appFeature: 'tools/battery',
  },
  'as-1670-4-2018|3.5.5': {
    covers:
      'The standby capacity the system has to hold — a long quiescent period followed by a full-load emergency period, with a shorter quiescent period allowed only where a power supply failure is continuously monitored. Choosing the wrong one of those two is the single biggest error in a battery sizing, and it is invisible until the mains actually fail.',
    appFeature: 'tools/battery',
  },
  'as-1670-4-2018|3.5.6': {
    covers:
      'The battery capacity equation itself, with its allowance for capacity lost over the battery’s useful life and its de-rating factor for discharge at the full-load rate. The battery calculator implements this equation rather than a rule of thumb.',
    appFeature: 'tools/battery',
  },
  'as-1670-4-2018|3.6.7': {
    covers:
      'Which transmission paths have to be supervised, and therefore which faults the system is obliged to find by itself instead of waiting for a technician. It also sets which paths the fire-rating requirements then apply to.',
  },
  'as-1670-4-2018|3.6.8': {
    covers:
      'Mechanical and fire protection of transmission paths, when a path need not be fire-rated because of where it runs, and the fire resistance of the building element the cable support system is fixed to. Most cable-support findings on an EWIS upgrade are this clause.',
  },
  'as-1670-4-2018|3.7': {
    covers:
      'The building’s own emergency instructions posted next to each control panel, so a warden taking control has them in front of them rather than in a folder in an office. The Standard deliberately does not write the procedure — that comes from the building.',
  },
  'as-1670-4-2018|3.9': {
    covers:
      'Commissioning: confirm every component operates to the final design, then record the result as the baseline data. A commissioning with no baseline recorded leaves nothing for the next service to compare against, which is the same as not commissioning.',
    appFeature: 'work/baselines',
  },
  'as-1670-4-2018|4.1': {
    covers:
      'Opens the emergency warning installation requirements, which apply on top of Sections 1 to 3 wherever a warning system is installed rather than instead of them.',
  },
  'as-1670-4-2018|4.2.1': {
    covers:
      'Audible warning signals are distributed through the emergency zones by loudspeakers, with amplifier redundancy so one failure cannot silence a zone, and with the design obliged to consider warning occupants who cannot hear it.',
    appFeature: 'tools/spl',
  },
  'as-1670-4-2018|4.2.2': {
    covers:
      'What is allowed to start the warning system — automatic detection where it is connected, manual call points where provided, and the manual controls on the panel. The starting point for any cause and effect matrix on an EWIS.',
    appFeature: 'site/cause-effect',
  },
  'as-1670-4-2018|4.2.3': {
    covers:
      'Where evacuate manual call points have to be: at each panel user interface, next to every warden intercom point, and in areas the detection or suppression system does not cover. Red call points already wired to the fire panel can satisfy this, which saves an argument on an upgrade.',
  },
  'as-1670-4-2018|4.2.4': {
    covers:
      'Manual call points themselves — mounting height, the clear space in front of and beside them, the colour and wording that go with each function (evacuate, other emergency, door release), and the requirement for two distinct actions to operate one. Colour is how a technician tells at a glance what a call point actually does before pressing it.',
  },
  'as-1670-4-2018|4.3': {
    covers:
      'The delay allowed before the system enters the emergency condition, where the building’s evacuation plan includes investigating the alarm, together with the override and the requirement that the delay is set to zero where the plan has no investigation procedure. A common finding, because a delay set years ago survives on a panel long after the building’s plan changed.',
    appFeature: 'site/cause-effect',
  },
  'as-1670-4-2018|4.4': {
    covers:
      'How long an alert signal may run in automatic mode before it is replaced by the evacuate signal. The time comes from the building’s emergency management plan rather than from the installer’s preference, and it is capped regardless.',
  },
  'as-1670-4-2018|4.8': {
    covers:
      'Pre-recorded speech messages in the warning signal, and the licence for a building’s emergency management plan to specify something other than the default. Check the plan before assuming the message on site is wrong.',
  },
  'as-1670-4-2018|4.10': {
    covers:
      'The interface between the warning system and the fire panel: the fault signal, the disable that lets the detection system be tested without evacuating the building, and the requirement that the disabled state is itself reported. Forgetting to restore this at the end of a service is how a building ends up with a silent EWIS.',
    appFeature: 'site/cause-effect',
  },
  'as-1670-4-2018|4.11': {
    covers:
      'Other sound systems loud enough to compete with the warning signal have to be shut down when it broadcasts. The gym’s music system or the shopping centre’s background audio is a real defect here, not a nuisance complaint.',
  },
  'as-1670-4-2018|4.12': {
    covers:
      'Using the warning system for paging or background music, which is allowed only where the emergency condition overrides it, the power supply is sized for the extra load, and system integrity and fault monitoring are maintained. Tenant paging quietly patched into an EWIS usually breaches at least one of those three.',
  },
  'as-1670-4-2018|5.1': {
    covers:
      'Opens the intercom requirements, which apply on top of Sections 1 to 3 wherever the installation includes an emergency intercom system.',
  },
  'as-1670-4-2018|5.2': {
    covers:
      'Intercom control equipment is installed to the same requirements as the warning control equipment — same location, clearance, covering door and environment rules — which is easy to overlook when the EICIE is a separate cabinet in a different room.',
  },
  'as-1670-4-2018|5.3.1': {
    covers:
      'The warden intercom point exists so a warden can readily control the evacuation of their area. Everything else in this clause follows from that single purpose, which is the test to apply when a WIP location looks odd.',
  },
  'as-1670-4-2018|5.3.2': {
    covers:
      'The sound level around a warden intercom point during an emergency must not stop the warden being heard by the control point. A loudspeaker sited too close to a WIP is the usual cause, and it only reveals itself under alarm conditions.',
    appFeature: 'tools/spl',
  },
  'as-1670-4-2018|5.3.3': {
    covers:
      'Where warden intercom points have to be — at the designated building entry point, in each emergency zone and on each storey near a designated exit, in emergency lifts, and by pump and sprinkler valve rooms where the emergency services ask for them — plus the height they are mounted at.',
  },
  'as-1670-4-2018|5.3.4': {
    covers:
      'The two-way call test: call from every warden intercom point and to every warden intercom point, confirming the right point is indicated and that speech is clear in both directions. Testing one direction only misses an entire class of fault.',
  },
  'as-1670-4-2018|5.3.5': {
    covers:
      'The audible call signal at a warden intercom point and the level it has to reach, so a warden knows the control point is calling them while an evacuation is under way around them.',
    appFeature: 'tools/spl',
  },

  // -------------------------------------------------------------------------
  // AS 2293 Set:2005 (AS 2293.1) — Emergency lighting, system design
  // -------------------------------------------------------------------------
  'as-2293-set-2005|1.6': {
    covers:
      'Alternative materials, designs and methods sit outside this Standard and become a performance solution assessed under the building code instead. The clause to cite when a product is offered as "equivalent" with nothing but a datasheet behind it.',
  },
  'as-2293-set-2005|1.7': {
    covers:
      'Alterations and additions to an existing emergency lighting installation, including the requirement to bring the affected part into compliance where the change would impair it. Partition changes and new ceiling finishes count, which is why a fitout can break lighting that nobody touched.',
    appFeature: 'tools/emergency-lighting',
  },
  'as-2293-set-2005|2.2': {
    covers:
      'How long the system has to keep running on emergency power — a longer duration at commissioning than in service, deliberately, to leave headroom for the capacity a battery loses with age. It is the figure a discharge test is judged against, and the reason a new install is tested harder than an old one.',
    appFeature: 'tools/emergency-lighting',
  },
  'as-2293-set-2005|2.3': {
    covers:
      'What has to happen when the normal lighting in an area fails: the relevant fittings energise from the emergency supply whether or not they were lit, with extra provisions where the normal lamps need time to restrike. It is why a discharge test that kills power to one board is not a whole-system test.',
    appFeature: 'tools/emergency-lighting',
  },
  'as-2293-set-2005|3.2': {
    covers:
      'The emergency power source for a centrally supplied system — its own room or enclosure, fire separated, identified and access-controlled, ventilated so equipment stays within temperature even during a discharge test, and with its outgoing circuits protected close to the battery.',
  },
  'as-2293-set-2005|3.3': {
    covers:
      'Batteries for a central system and how they are installed — types designed for continuous float charging, and the conditions they have to be kept in. A central battery is a different animal from the sealed pack in a single-point fitting and is not serviced the same way.',
  },
  'as-2293-set-2005|3.4': {
    covers:
      'The battery charger assembly: the voltage ceiling it must not push onto the fittings, and the rating that guarantees the battery can recover from a full discharge in time to survive a second one. A charger that cannot recharge inside the window leaves the building unprotected after a test.',
  },
  'as-2293-set-2005|3.5': {
    covers:
      'Inverters in a centrally supplied system, which turn the battery supply into the supply the luminaires actually run on. Their data forms part of the operating and maintenance manual, so a system with no inverter details cannot be properly maintained.',
    confidence: 'medium',
  },
  'as-2293-set-2005|3.6': {
    covers:
      'The alarm system that warns of a malfunction in the central emergency supply, where its indications have to be seen and heard, and the rule that it cannot be reset while the fault is still present. It is the difference between a central system that fails loudly and one that fails silently.',
  },
  'as-2293-set-2005|4.2': {
    covers:
      'Single-point (self-contained) fittings: the test switch that simulates a supply failure, where it may be and why it must not be able to be left in the test position, and the charger indicator that has to be visible however the fitting is mounted. The two things a technician actually touches on a six-monthly.',
    appFeature: 'tools/emergency-lighting',
  },
  'as-2293-set-2005|4.3': {
    covers:
      'The facilities required to run a discharge test on the whole installation without cutting supply to the normal lighting, whether operated manually or automatically, with no charge reaching the battery during the test. It also acknowledges plainly that the building is without effective emergency lighting for part of the test, which is why the timing of a discharge test is a real decision.',
    appFeature: 'tools/emergency-lighting',
  },
  'as-2293-set-2005|5.2': {
    covers:
      'How many emergency luminaires an area gets, including the cap on how much floor area a single fitting may serve however bright it is. The starting point when a room has one fitting and someone asks whether that is enough.',
  },
  'as-2293-set-2005|5.3': {
    covers:
      'Permits an internally illuminated exit sign to do double duty as an emergency escape luminaire, provided it meets every requirement for both roles. Useful, and frequently claimed for signs that do not.',
  },
  'as-2293-set-2005|5.4': {
    covers:
      'Direct lighting installations: the specific locations that must have a luminaire near them — the approach side of doorways requiring an exit sign, and the hazards along an escape route — plus the spacing and illuminance rules that follow. Most emergency lighting coverage questions land here.',
  },
  'as-2293-set-2005|5.5': {
    covers:
      'Indirect lighting installations, where the floor-level illuminance is achieved by bouncing light off the room surfaces and has to be calculated rather than measured off a spacing table. The surface reflectances the design assumed are recorded, because repainting a ceiling darker can quietly fail the design.',
  },
  'as-2293-set-2005|5.6': {
    covers:
      'Lighting of stairways, by spacing rules or by calculation, so every flight and landing is lit rather than just the head and foot of the stair. Stairs are where an emergency lighting failure hurts people.',
  },
  'as-2293-set-2005|6.2': {
    covers:
      'Which locations require an exit sign at all, determined by reference to the building code rather than by this Standard. It is why "should there be a sign here" is often a building-code question wearing an emergency lighting hat.',
  },
  'as-2293-set-2005|6.3': {
    covers:
      'Restricts externally illuminated exit signs to areas with automatic smoke exhaust or exclusion, because they are the type most degraded by smoke. Reach for it when an existing externally lit sign is found somewhere it should not be.',
  },
  'as-2293-set-2005|6.4': {
    covers:
      'Which type of exit sign an area gets — the standard internally illuminated sign, or the low-illuminance variant for spaces such as cinemas and theatres that are normally kept dark. Fitting the wrong one is a real non-conformance, not a preference.',
  },
  'as-2293-set-2005|6.5': {
    covers:
      'The three messages an exit sign pictogram is allowed to convey — straight on, left, right — and the permitted element combinations. The clause behind a sign pointing the wrong way, which is a defect a technician can and should raise.',
  },
  'as-2293-set-2005|6.6': {
    covers:
      'How the size of the pictorial element is derived from the viewing distance the design needs, including the calculation for long sight lines. It is why a sign that is legally correct in a corridor is undersized across an atrium.',
  },
  'as-2293-set-2005|6.7': {
    covers:
      'Illumination of exit signs — internally illuminated signs by reference to the product standard, externally illuminated signs by the illuminance on the face, its evenness, and where the light source may sit so it does not wash out the contrast.',
  },
  'as-2293-set-2005|6.8': {
    covers:
      'The physical conditions of an exit sign installation: the mounting height band that keeps the sign in a person’s field of view, and the viewing distance the installed sign may be credited with. A sign mounted too high is out of compliance even though it is easier to see from across the room.',
  },
  'as-2293-set-2005|6.9': {
    covers:
      'The marking on an exit sign, most usefully the maximum viewing distance printed on its face. That number lets a technician check a sign against the sight line in front of it without measuring anything about the sign itself.',
  },
  'as-2293-set-2005|7.2': {
    covers:
      'The permitted voltage drop from the emergency power source to any point in a centrally supplied installation, which is tighter than the general wiring rules allow because the source voltage is already sagging at the end of the discharge period.',
  },
  'as-2293-set-2005|7.3': {
    covers:
      'Overcurrent protection on the emergency lighting load conductors, required regardless of the operating voltage, so a second earth fault cannot create a hazard on an unearthed extra-low-voltage system.',
  },
  'as-2293-set-2005|7.4': {
    covers:
      'Protecting the emergency lighting distribution against fire, by fire-protected wiring classified under the wiring systems standard, with sensing circuits handled differently so a fire-induced failure switches the lighting on rather than off.',
  },
  'as-2293-set-2005|7.5': {
    covers:
      'Emergency lighting submains are kept out of enclosures shared with unrelated wiring, and labelled at access points where they are not enclosed. It is what stops an electrician disconnecting emergency lighting while chasing something else.',
  },
  'as-2293-set-2005|7.6': {
    covers:
      'How final subcircuits are arranged so one circuit failure does not black out a whole escape route — fire-isolated stairs and passages on their own circuits with alternate fittings split between them, and large undivided areas split across more than one circuit. Worth checking whenever a whole area goes dark on one discharge test.',
  },
  'as-2293-set-2005|8.2': {
    covers:
      'The operating and maintenance manual the installer has to leave — as-installed plans with every luminaire and sign individually designated, battery, charger and inverter data for a central system, and the step-by-step maintenance schedule. Without it, a technician is inventing the test procedure on the spot.',
    appFeature: 'work/baselines',
  },
  'as-2293-set-2005|8.3': {
    covers:
      'The logbook or equivalent record the installer provides for maintenance results, corrective actions, who did the work and when, plus the next expected discharge date where automatic test facilities are fitted. This is the paper trail an occupier statement ultimately rests on.',
    appFeature: 'work/reports',
  },

  // -------------------------------------------------------------------------
  // AS 2293.3:2005 — Emergency escape luminaires and exit signs (product)
  // -------------------------------------------------------------------------
  'as-2293-3-2005|2.1': {
    covers:
      'Emergency escape luminaires are ordinary luminaires first and have to satisfy the general luminaire standard before anything in this document applies. Relevant when assessing a fitting that carries emergency approval but no luminaire approval.',
  },
  'as-2293-3-2005|2.2': {
    covers:
      'Luminaire classification, which is what the alphanumeric code on the fitting label encodes. Reading that code is how a technician works out whether a replacement fitting really matches the one being taken out.',
    appFeature: 'tools/emergency-lighting',
  },
  'as-2293-3-2005|2.3': {
    covers:
      'How quickly a luminaire has to reach useful light output after the supply fails, both from cold and immediately after a period of running. A fitting that comes up slowly leaves people in the dark at the moment they start moving.',
  },
  'as-2293-3-2005|2.4': {
    covers:
      'What has to be marked on the body of an emergency luminaire, and the rule that it goes on the body rather than on a diffuser that can be swapped. It is why identifying a fitting means opening it rather than reading the cover.',
    appFeature: 'tools/emergency-lighting',
  },
  'as-2293-3-2005|3.2': {
    covers:
      'The three types of exit sign this Standard recognises — standard internally illuminated, low illuminance area, and externally illuminated. Everything about appearance, illumination and permitted location keys off which type a sign is.',
  },
  'as-2293-3-2005|3.3': {
    covers:
      'The appearance of the sign face: the pictorial elements it may be built from, the combinations of them that are allowed, and the shape the green field has to be. A sign that reads correctly but uses a non-standard element combination is still non-compliant.',
  },
  'as-2293-3-2005|3.4': {
    covers:
      'How an illuminated exit sign is measured for luminance and evenness, including the viewing angles the measurements are taken at. A dim sign fails here rather than under any installation clause, and the failure is measured rather than judged by eye.',
  },
  'as-2293-3-2005|3.5': {
    covers:
      'How the maximum viewing distance for a sign follows from the height of its pictorial element, including the calculation for oversized signs. This is the number that gets printed on the sign face and used on site.',
  },
  'as-2293-3-2005|3.6': {
    covers:
      'Marking of exit signs, split between the body and the face, with the maximum viewing distance and its permitted lettering size on the face. It is the marking a technician actually uses when checking a sign against its sight line.',
  },
  'as-2293-3-2005|4.1': {
    covers:
      'Opens the requirements specific to self-contained fittings, which apply on top of the general luminaire or exit sign requirements. It also allows a self-contained fitting to be a normal luminaire plus an emergency conversion module, provided the whole assembly complies.',
  },
  'as-2293-3-2005|4.2': {
    covers:
      'Self-contained fittings have to work over the temperature range they will actually see, with specific selection required for extremes such as coolrooms. Battery life collapses in heat, so a fitting in a hot roof space fails early for reasons this clause anticipates.',
    appFeature: 'tools/emergency-lighting',
  },
  'as-2293-3-2005|4.3': {
    covers:
      'Arrangement and control inside a self-contained fitting, including the automatic cut-off that disconnects the battery before a cell is damaged by deep discharge. It is why a fitting that goes dark part-way through a discharge test has not necessarily failed the test on lamp life.',
  },
  'as-2293-3-2005|4.4': {
    covers:
      'The batteries permitted in a self-contained fitting — sealed rechargeable types designed for standby duty — and the mounting restrictions some of them carry. It also explains why service life is governed by the temperature the battery sits at rather than by hours of operation.',
    appFeature: 'tools/emergency-lighting',
  },
  'as-2293-3-2005|4.5': {
    covers:
      'The battery charger inside a self-contained fitting, rated so the battery can recover from a full discharge inside a bounded recharge window and then survive a second discharge. A fitting that passes a test and fails the retest points here.',
  },
  'as-2293-3-2005|4.6': {
    covers:
      'Control gear where the fitting uses discharge lamps, so the lamp actually starts and runs correctly on the emergency supply rather than only on the mains.',
  },
  'as-2293-3-2005|4.7': {
    covers:
      'Electrical construction of the emergency power supply unit — protection against mains transients, secure fixing, and protection of tracks, relays and connectors against corrosion, dust and humidity. The clause behind fittings that fail early in coastal and industrial environments.',
  },
  'as-2293-3-2005|4.8': {
    covers:
      'Fittings with built-in automatic discharge testing: how the test runs, that no charge reaches the battery during it, what happens if the mains fail mid-test, and the distinct indications for normal, recently tested and passed, and tested and failed. Knowing what a slow flash means against a fast flash is the whole point on a site full of self-testing fittings.',
    appFeature: 'tools/emergency-lighting',
  },
  'as-2293-3-2005|4.9': {
    covers:
      'Additional marking on a self-contained fitting — what is needed to replace the battery correctly, any mounting restriction, and identification of the test switch, charger indicator and automatic test indications. Without it the next technician is guessing at the battery type.',
    appFeature: 'tools/emergency-lighting',
  },

  // -------------------------------------------------------------------------
  // AS/NZS 2293.2:1995 — Emergency lighting, inspection and maintenance
  // -------------------------------------------------------------------------
  'as-nzs-2293-2-1995|1.4': {
    covers:
      'The two general obligations the procedure sections rest on: the work is done only by people qualified and experienced for it, and the results go into a durable record covering every procedure carried out. A discharge test with no record is not a discharge test.',
    appFeature: 'work/reports',
  },
  'as-nzs-2293-2-1995|2.1': {
    covers:
      'Sets the rhythm for centrally supplied systems — the procedures are carried out at their stated intervals, corrective action is taken as necessary, and both the results and the actions are logged. It also lets battery maintenance done to the stationary battery standards stand in for the battery clauses here.',
    appFeature: 'tools/emergency-lighting',
  },
  'as-nzs-2293-2-1995|3.1': {
    covers:
      'Sets the rhythm for single-point fittings, and permits testing groups on a rotational basis provided no individual fitting exceeds its own interval. That permission is what makes a large site testable, and it is also how sites accidentally leave a group untested for years.',
    appFeature: 'tools/emergency-lighting',
  },

  // -------------------------------------------------------------------------
  // AS 2444:2001 — Portable fire extinguishers and blankets
  // -------------------------------------------------------------------------
  'as-2444-2001|1.2': {
    covers:
      'How this Standard is picked up by the building code, and which of its sections that reference actually reaches. Worth knowing when someone argues that a vehicle or small craft requirement applies to a building.',
  },
  'as-2444-2001|3.1': {
    covers:
      'An extinguisher is assembled, charged and commissioned to the maintenance standard before this Standard’s location rules apply to it. A new extinguisher hung on a bracket without being commissioned has skipped a step that never shows up later.',
    appFeature: 'tools/extinguisher',
  },
  'as-2444-2001|3.4': {
    covers:
      'The extinguisher or its location sign has to be visible from a distance in every direction of approach. It is the clause that catches an extinguisher hidden behind a pallet or a roller door, and it is judged from where a user would be standing.',
    appFeature: 'tools/extinguisher',
  },
  'as-2444-2001|3.5': {
    covers:
      'Every extinguisher is on a proper bracket, in a cabinet, or restrained — facing outward, and in a vehicle able to survive impact and braking. An extinguisher standing on the floor is a defect, and a common one on industrial sites.',
    appFeature: 'tools/extinguisher',
  },
  'as-2444-2001|3.6': {
    covers:
      'Extinguisher cabinets and enclosures: the door must not encroach on the path of travel, the cabinet is marked or transparent enough to show what is inside, and a locked cabinet needs a frangible panel to reach the latch. The frangible panel is the part most often missing.',
    appFeature: 'tools/extinguisher',
  },
  'as-2444-2001|3.7': {
    covers:
      'Requires a record of the type, disposition and location of the extinguishers on site, kept to the maintenance standard. That record is what an asset register is, and it is what makes a missing extinguisher detectable rather than invisible.',
    appFeature: 'site/assets',
  },
  'as-2444-2001|3.8': {
    covers:
      'Fire points — a marked position holding grouped extinguishers, fixed or mobile, used where travel distances cannot otherwise be met. Mobile fire points bring their own problem: the storage location has to be separately protected.',
    appFeature: 'tools/extinguisher',
  },
  'as-2444-2001|3.9': {
    covers:
      'The environment an extinguisher may live in, with thermal protection or a suitable type outside the normal temperature range, and protection in aggressive environments such as coastal exposure, corrosive atmospheres and heavy vibration. This is why a unit that keeps corroding is a placement problem, not a product problem.',
    appFeature: 'tools/extinguisher',
  },
  'as-2444-2001|4.1': {
    covers:
      'Distribution follows the hazard present rather than the size of the area, and a number of small extinguishers cannot be added together to make up a required rating. Both halves of that get argued on site, and both are settled here.',
    appFeature: 'tools/extinguisher',
  },
  'as-2444-2001|4.4': {
    covers:
      'Complementary protection for risks the general Class A and B distribution does not answer — energised electrical equipment, significant switchboards, concentrations of electronic equipment, and cooking oils and fats — each with its own distance band and its own required classification on the nearest unit. The switchboard and the deep fryer are the two that come up on nearly every commercial site.',
    appFeature: 'tools/extinguisher',
  },
  'as-2444-2001|5.1': {
    covers:
      'Extinguishers for vehicles, caravans and small craft, set as a minimum that a regulator may raise. Relevant to Safe QLD’s own fleet as much as to any customer asset.',
  },
  'as-2444-2001|5.3': {
    covers:
      'Where an extinguisher goes in a vehicle so it can be reached safely in an emergency, and the bracket that has to hold it through impact and braking. A loose extinguisher in a cab is a projectile before it is a firefighting appliance.',
  },
  'as-2444-2001|6.1': {
    covers:
      'What a fire blanket is actually for — small Class A and B fires, cooking oil and fat fires, a thermal barrier, and clothing fires on a person — and the size range they are made in. It frames every selection and placement decision that follows.',
    appFeature: 'tools/extinguisher',
  },
  'as-2444-2001|6.2': {
    covers:
      'Selecting a blanket size for the hazard, with a larger size required where a clothing fire on a person is part of the risk and smaller ones considered where the space is confined. It is why a kitchen and a laboratory do not get the same blanket.',
  },
  'as-2444-2001|6.4': {
    covers:
      'Fire blanket location signs — size driven by the distance they must be legible from, placement above or adjacent to the blanket, and mounting height. A blanket in a cupboard with no sign is effectively not there.',
    appFeature: 'tools/extinguisher',
  },
  'as-2444-2001|6.5': {
    covers:
      'Mounting a fire blanket container so it survives the pull of the blanket being ripped out, with enough clear space to get it out in one movement. A container mounted behind a bench fails this even though the blanket inside is perfect.',
  },

  // -------------------------------------------------------------------------
  // AS 2441:2005 — Installation of fire hose reels
  // -------------------------------------------------------------------------
  'as-2441-2005|2': {
    covers:
      'Fixes what this Standard does and does not reach: the location and installation of hose reels. The reel assembly itself answers to the hose reel product standard and its servicing to AS 1851, so a hose reel finding usually cites two documents.',
    appFeature: 'tools/routines',
  },
  'as-2441-2005|4': {
    covers:
      'The definitions that decide the rest — the Class A hazard classes of light, ordinary and high, and the distinction between surface-mounted and swing reels. Getting the hazard class wrong changes the reel selection and, with it, the whole coverage argument.',
  },
  'as-2441-2005|5': {
    covers:
      'Points the reel assembly itself at the hose reel product standard. This is the clause behind rejecting a non-conforming replacement reel that fits the bracket perfectly.',
  },
  'as-2441-2005|7': {
    covers:
      'The connection fitting between the stop valve and the reel, its size, and the prohibition on flexible connections that are not part of a complying reel. A flexible hose spliced in during a repair is a defect that looks like good workmanship.',
  },
  'as-2441-2005|8': {
    covers:
      'Where a pumpset is needed to serve hose reels, it is designed and tested to the pumpset standard, with the extra requirements that standard carries for hose reels.',
  },
  'as-2441-2005|11': {
    covers:
      'Mounting: the spindle height band, the stop valve height and how far it may be from the spindle, the clear radial space around the reel and around the valve handwheel, the operating instructions facing the person approaching, and the load the mounting structure has to take. This is the clause a tape measure settles.',
    appFeature: 'tools/routines',
  },
  'as-2441-2005|12': {
    covers:
      'The commissioning checks after installation — no leakage under pressure with the nozzle shut, and the hose running out easily in every intended direction under a bounded pull force. The second check is the one that finds a reel mounted where the hose fouls a doorway.',
  },
  'as-2441-2005|13': {
    covers:
      'The record of installation, which is the baseline every later hose reel service is measured against. A site with no record can only be inspected against the Standard from scratch, which is a different and longer job.',
    appFeature: 'work/baselines',
  },

  // -------------------------------------------------------------------------
  // AS 1905.1:2005 — Fire-resistant doorsets
  // -------------------------------------------------------------------------
  'as-1905-1-2005|1.2': {
    covers:
      'What this Standard applies to and where its boundary sits, which matters because smoke doors and solid core doors are separate obligations that get serviced on the same walk-around and cited to the wrong document.',
    appFeature: 'tools/fire-door',
  },
  'as-1905-1-2005|1.4': {
    covers:
      'The definitions a fire door assessment is written in — doorset, hardware against furniture, essential latching components, fire resistance level, formal opinion, tested specimen, certifier. "Formal opinion" and "tested specimen" in particular decide whether a variation found on site is acceptable or a defect.',
    appFeature: 'tools/fire-door',
  },
  'as-1905-1-2005|2.1': {
    covers:
      'The general design requirements every fire doorset meets: no restriction on materials beyond what the tested specimen proves, self-closing or automatic operation reverting to self-closing when the hold-open device loses power, and hardware that leaves the door self-latching. Self-closing and self-latching are the two things a service actually tests.',
    appFeature: 'tools/fire-door',
  },
  'as-1905-1-2005|2.2': {
    covers:
      'Design requirements specific to side-hung and double-acting doorsets — the door seat rebate, hinge and pivot alignment and material, the force needed to swing the leaf, and closer behaviour. A leaf that binds or drops is a hinge and alignment finding under this clause.',
    appFeature: 'tools/fire-door',
  },
  'as-1905-1-2005|2.3': {
    covers:
      'Design requirements specific to sliding fire doorsets, including recessed pulls and the directional arrows that tell an occupant which way the door opens. Sliding fire doors in warehouses are rarely used by occupants, which is exactly why the marking matters.',
    appFeature: 'tools/fire-door',
  },
  'as-1905-1-2005|4.1': {
    covers:
      'The idea the whole Standard rests on: a specimen doorset is fire tested, and every doorset installed afterwards has to be equivalent to it. Any departure has to be covered either by the fire test standard or by a formal opinion. It is why "it looks the same" is not an argument.',
    appFeature: 'tools/fire-door',
  },
  'as-1905-1-2005|4.2': {
    covers:
      'Variations from the tested specimen permitted only with a formal opinion from a registered testing authority, itself derived from full-scale fire tests. When a site has a door with unusual hardware and a letter in the folder, this clause says what that letter has to be.',
    appFeature: 'tools/fire-door',
  },
  'as-1905-1-2005|5.1': {
    covers:
      'Installation has to match the tested specimen except where specific allowances apply. Half the fire door defects raised on an audit are installation departures rather than product faults.',
    appFeature: 'tools/fire-door',
  },
  'as-1905-1-2005|5.2': {
    covers:
      'The doorsill: non-combustible unless an alternative was fire tested, and projecting beyond the opening for a sliding doorset. Worth checking when a floor covering has been replaced and the sill detail has quietly changed.',
    appFeature: 'tools/fire-door',
  },
  'as-1905-1-2005|5.3': {
    covers:
      'Fixing the doorframe as in the tested specimen, with the anchoring and grouting guidance that goes with masonry construction. An ungrouted jamb cavity is a defect nobody can see once the architrave is on, which is why the installation record matters.',
    appFeature: 'tools/fire-door',
  },
  'as-1905-1-2005|5.4': {
    covers:
      'The allowances for fixing a doorframe to an existing wall rather than building it in — the gap permitted around the frame, anchoring points matched to the tested specimen, and full grouting of the jamb and head cavities. This is the clause a retrofit fire door is judged against.',
    appFeature: 'tools/fire-door',
  },
  'as-1905-1-2005|5.7': {
    covers:
      'The final check at the end of installation: the doorset latches from the fully open position and from any intermediate position, and the closer behaves correctly. It is the same test a maintenance technician repeats years later, which makes it the most useful clause in the Standard on a service.',
    appFeature: 'tools/fire-door',
  },
  'as-1905-1-2005|6.3': {
    covers:
      'The written evidence handed to the building owner after installation — a numbered certificate confirming the doorset was inspected and matches the tested specimen, plus the schedule of evidence behind it. On a maintenance job this is the folder to ask for before arguing about a tag.',
    appFeature: 'tools/fire-door',
  },
};

// ---------------------------------------------------------------------------
// Merging notes into the catalogue
// ---------------------------------------------------------------------------

/** The key a note is stored under. */
export function clauseNoteKey(docId: string, ref: string): string {
  return `${docId}|${ref}`;
}

/** Splits a key back into its parts, or undefined where it is not one. */
export function parseClauseNoteKey(key: string): { docId: string; ref: string } | undefined {
  const at = key.indexOf('|');
  if (at <= 0 || at === key.length - 1) return undefined;
  return { docId: key.slice(0, at), ref: key.slice(at + 1) };
}

/**
 * What a note is worth, by the document it belongs to.
 *
 * Returns undefined rather than a default for a key that is not a note or a
 * document with no recorded provenance, so a caller can never present a
 * description as sourced when nobody recorded where it came from.
 */
export function clauseNoteSource(key: string): NoteProvenance | undefined {
  const parsed = parseClauseNoteKey(key);
  const note = CLAUSE_NOTES[key];
  if (!parsed || !note) return undefined;
  const provenance = NOTE_SOURCES[parsed.docId];
  if (!provenance) return undefined;
  return note.confidence ? { ...provenance, confidence: note.confidence } : provenance;
}

export type ClauseNoteConflictReason =
  /** The key names a document the catalogue does not have. */
  | 'unknown-document'
  /** The document exists but has no clause with that reference. */
  | 'unknown-clause'
  /** The catalogue already describes that clause, and a merge would overwrite it. */
  | 'already-described';

export interface ClauseNoteConflict {
  key: string;
  reason: ClauseNoteConflictReason;
}

/**
 * Every note that cannot be merged, and why.
 *
 * A note keyed to a clause that does not exist is silently useless, and a note
 * that would overwrite a description already in the catalogue is worse than
 * useless — it loses curated text. Both are reported here rather than being
 * swallowed by the merge, and the test asserts the list is empty.
 */
export function clauseNoteConflicts(
  docs: StandardDoc[],
  notes: Record<string, ClauseNote> = CLAUSE_NOTES,
): ClauseNoteConflict[] {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const conflicts: ClauseNoteConflict[] = [];

  for (const key of Object.keys(notes)) {
    const parsed = parseClauseNoteKey(key);
    if (!parsed) {
      conflicts.push({ key, reason: 'unknown-document' });
      continue;
    }
    const doc = byId.get(parsed.docId);
    if (!doc) {
      conflicts.push({ key, reason: 'unknown-document' });
      continue;
    }
    // A reference can legitimately appear twice in one document — AS 1670.1
    // prints clause 3.8 under two spellings of its heading — so every matching
    // clause is considered, not just the first.
    const matches = doc.clauses.filter((c) => c.ref === parsed.ref);
    if (matches.length === 0) {
      conflicts.push({ key, reason: 'unknown-clause' });
      continue;
    }
    if (matches.some((c) => c.covers !== undefined)) {
      conflicts.push({ key, reason: 'already-described' });
    }
  }
  return conflicts;
}

/**
 * The catalogue with these descriptions merged in.
 *
 * Pure: the input is not mutated, so the register of clause numbers stays a
 * register and this module stays the only place descriptions are written. A
 * clause the catalogue already describes keeps its own text — the merge fills
 * gaps and never overwrites, so a conflict is a silent no-op here and a loud
 * failure in `clauseNoteConflicts`.
 */
export function withClauseNotes(
  docs: StandardDoc[],
  notes: Record<string, ClauseNote> = CLAUSE_NOTES,
): StandardDoc[] {
  return docs.map((doc) => ({
    ...doc,
    clauses: doc.clauses.map((clause) => {
      if (clause.covers !== undefined) return clause;
      const note = notes[clauseNoteKey(doc.id, clause.ref)];
      if (!note) return clause;
      return {
        ...clause,
        covers: note.covers,
        ...(note.appFeature ? { appFeature: note.appFeature } : {}),
      };
    }),
  }));
}

// ---------------------------------------------------------------------------
// The Queensland legislation layer
// ---------------------------------------------------------------------------

/**
 * Where the regulation text below came from.
 *
 * Two sources, because they answer different questions. The consolidation on
 * the Queensland legislation register is the law as it stands; the 2012 reprint
 * is the copy Safe QLD holds and the one the index was read from. The section
 * numbers and headings of the whole of Part 5, and the repeal of sections 51 and
 * 52, were confirmed against the current consolidation, and four sections had
 * their operative wording quoted back and matched character for character. Every
 * entry says which of those it is rather than implying the stronger one.
 */
export const BFSR_CITATION = {
  title: 'Building Fire Safety Regulation 2008 (Qld)',
  instrument: 'SL 2008 No. 160',
  madeUnder: 'Building Act 1975 and Fire Services Act 1990',
  officialUrl: 'https://www.legislation.qld.gov.au/view/whole/html/inforce/current/sl-2008-0160',
  /** The consolidation the Part 5 sections were verified against. */
  currentAsAt: '20/06/2025',
  reproductionNote:
    'Queensland Crown material, published free on the legislation register and reproduced faithfully here. Unlike an Australian Standard it may be quoted in full, and the sections that carry an obligation are.',
} as const;

export type BfsrVerification = 'current-consolidation' | 'reprint-2c-2012';

export const BFSR_VERIFICATION: Record<BfsrVerification, { source: string; asAt: string; confidence: NoteConfidence }> = {
  'current-consolidation': {
    source: `Checked word for word against the current consolidation at ${BFSR_CITATION.officialUrl}`,
    asAt: BFSR_CITATION.currentAsAt,
    confidence: 'high',
  },
  'reprint-2c-2012': {
    source: "Read from Safe QLD's copy of Reprint 2C of the Building Fire Safety Regulation 2008, and not re-checked against the current consolidation",
    asAt: '01/01/2012',
    confidence: 'medium',
  },
};

/** Who the obligation falls on. The same section can bind more than one. */
export type BfsrDuty = 'occupier' | 'owner' | 'maintainer' | 'any-person';

/** A lettered or numbered element within a section, where the detail lives. */
export interface BfsrElement {
  /** As the section prints it: "(2)(g)(i)". */
  para: string;
  requires: string;
}

export interface BfsrSection {
  /** As cited: "49", "55A". */
  section: string;
  part: string;
  /** Exactly as the regulation heads it. */
  heading: string;
  duty: BfsrDuty[];
  /** What it requires, in our words, for someone who has to act on it today. */
  requires: string;
  /**
   * The operative words, reproduced faithfully. Present only where the exact
   * wording decides something — a test, a deadline, a list. Crown material.
   */
  text?: string;
  elements?: BfsrElement[];
  /** Maximum penalty in penalty units, where the section carries one. */
  maxPenaltyUnits?: number;
  appFeature?: string;
  /**
   * How far this entry has been verified, which drives its source and
   * confidence. `current-consolidation` is claimed only where the reproduced
   * `text` was quoted back from the register and matched exactly; `requires` and
   * `elements` are always our own summary of the section as read from Safe QLD's
   * 2012 reprint.
   */
  verified: BfsrVerification;
}

/**
 * The sections of the Building Fire Safety Regulation 2008 that bear on this app.
 *
 * Not the whole regulation — the fee parts and most of the transitional
 * provisions are left out because nothing in this app touches them, and an index
 * padded with sections nobody uses makes the ones that matter harder to find.
 * Part 5 is complete.
 */
export const BFSR_2008: BfsrSection[] = [
  {
    section: '4',
    part: 'Part 1 — Preliminary',
    heading: 'Main objects of regulation',
    duty: [],
    requires:
      'The two objects everything else serves: that people can get out of a building safely and quickly, and that prescribed fire safety installations are maintained. Useful when arguing whether a defect matters — if it defeats one of these, it matters.',
    verified: 'reprint-2c-2012',
  },
  {
    section: '5',
    part: 'Part 2 — Means of escape from buildings',
    heading: 'Meaning of evacuation route',
    duty: [],
    requires:
      'Defines an evacuation route as the path of travel out through a final exit to a place of safety, and — the part people miss — includes the air space above that path. A stored item hanging over a corridor obstructs the route.',
    verified: 'reprint-2c-2012',
  },
  {
    section: '7',
    part: 'Part 2 — Means of escape from buildings',
    heading: 'Person not to obstruct an evacuation route',
    duty: ['any-person'],
    requires:
      'Nobody may place a thing within two metres outside a final exit, or anywhere on an evacuation route where it would unduly restrict, hinder or delay someone escaping. Whether it would is judged against who actually uses that route, including people with special needs, and whether the thing would be pushed aside in a rush.',
    maxPenaltyUnits: 30,
    appFeature: 'work/defects',
    verified: 'reprint-2c-2012',
  },
  {
    section: '8',
    part: 'Part 2 — Means of escape from buildings',
    heading: 'Occupier not to allow evacuation route to be obstructed',
    duty: ['occupier'],
    requires:
      'The occupier’s side of the same obligation: they must not allow a thing to be placed or to remain in those positions, and must take reasonable steps to stop other people obstructing the route. This is why an obstruction found on a routine is reported to the occupier rather than just moved.',
    maxPenaltyUnits: 30,
    appFeature: 'work/defects',
    verified: 'reprint-2c-2012',
  },
  {
    section: '9',
    part: 'Part 2 — Means of escape from buildings',
    heading: 'Occupier not to allow final exit of adjoining building to be obstructed',
    duty: ['occupier'],
    requires:
      'Extends the obstruction duty across a boundary: an occupier must not let their bins, stock or parked vehicles block a neighbouring building’s final exit. Relevant in food courts, strip shops and shared car parks, where the offender and the affected building have different owners.',
    maxPenaltyUnits: 30,
    verified: 'reprint-2c-2012',
  },
  {
    section: '10',
    part: 'Part 2 — Means of escape from buildings',
    heading: 'Meaning of locking a door',
    duty: [],
    requires:
      'Defines locking to include fastening a door or otherwise interfering with its ability to open, and then carves out the doors that are not treated as locked: those openable from the inside by a single downward or pushing action with one hand, or in another way that complies with the building code. It is the test to apply to a chain, a bolt or an electric lock found on an exit door.',
    appFeature: 'work/defects',
    verified: 'reprint-2c-2012',
  },
  {
    section: '11',
    part: 'Part 2 — Means of escape from buildings',
    heading: 'General obligations about locking doors',
    duty: ['any-person', 'occupier'],
    requires:
      'Nobody may lock a door on an evacuation route while knowing, or when they ought reasonably to know, that someone is inside on the internal side of it, and the occupier must ensure it does not happen. A locked exit with people behind it is one of the few things on a fire safety inspection that is an immediate danger rather than a paperwork problem.',
    maxPenaltyUnits: 30,
    appFeature: 'work/defects',
    verified: 'reprint-2c-2012',
  },
  {
    section: '13',
    part: 'Part 2 — Means of escape from buildings',
    heading: 'Evacuation routes to be kept isolated',
    duty: ['any-person'],
    requires:
      'Prohibits installing or altering mechanical ventilation or air conditioning, or doing anything else, that could let air flow onto an evacuation route from elsewhere in the building during a fire. This is the statutory hook behind unsealed penetrations into a fire-isolated stair, which is otherwise easy to write up as merely untidy.',
    maxPenaltyUnits: 30,
    verified: 'reprint-2c-2012',
  },
  {
    section: '14',
    part: 'Part 3 — Occupancy limits for buildings',
    heading: 'Meaning of occupancy safety factors',
    duty: [],
    requires:
      'Lists what makes a number of people safe or unsafe in a building, and expressly includes the prescribed fire safety installations among those factors. It is the clearest statement in the regulation that a system out of service changes how many people may safely be in the building.',
    appFeature: 'work/impairments',
    verified: 'reprint-2c-2012',
  },
  {
    section: '16',
    part: 'Part 3 — Occupancy limits for buildings',
    heading: 'Limits on the number of persons in a building',
    duty: ['occupier'],
    requires:
      'Caps occupancy by reference to the Queensland Development Code for budget accommodation and residential services, and to the building code otherwise. Reach for it when a venue’s stated capacity is being used to justify a fire safety argument.',
    maxPenaltyUnits: 30,
    verified: 'reprint-2c-2012',
  },
  {
    section: '18',
    part: 'Part 4 — Evacuation planning, instruction and practice',
    heading: 'Meaning of evacuation diagram',
    duty: [],
    requires:
      'Sets out the fire safety reference points an evacuation diagram has to show — where the reader is standing, the route to the nearest exit, every exit, intercommunication devices in common areas, manually operated fire alarms, the firefighting equipment, the assembly areas, and the route to them — and that it has to be understandable by whoever will be reading it in an emergency. This is the list to check a diagram against, and firefighting equipment on it has to match what is actually on the wall.',
    appFeature: 'site/assets',
    verified: 'reprint-2c-2012',
  },
  {
    section: '21',
    part: 'Part 4 — Evacuation planning, instruction and practice',
    heading: 'General requirements',
    duty: ['occupier'],
    requires:
      'What the building’s fire and evacuation plan has to be and state — kept in writing, including the evacuation diagrams, naming the building and its owner and occupier, setting out the evacuation coordination procedures, describing how the firefighting equipment and manual alarms are operated, and naming the evacuation coordinator and the fire safety adviser for a high occupancy building.',
    maxPenaltyUnits: 30,
    verified: 'reprint-2c-2012',
  },
  {
    section: '28',
    part: 'Part 4 — Evacuation planning, instruction and practice',
    heading: 'Reviewing a fire and evacuation plan',
    duty: ['occupier'],
    requires:
      'The plan is reviewed at intervals of not more than a year, a written record of the review is kept, and in a high occupancy building a copy goes to the fire safety adviser within a month. A plan that still lists last decade’s installations fails a review that never happened.',
    maxPenaltyUnits: 20,
    verified: 'reprint-2c-2012',
  },
  {
    section: '30',
    part: 'Part 4 — Evacuation planning, instruction and practice',
    heading: 'Evacuation signs and diagrams to be displayed',
    duty: ['occupier'],
    requires:
      'Evacuation signs and diagrams are located appropriately on each evacuation route having regard to the number and location of exits, displayed conspicuously, and securely attached to a wall or the internal side of a door. A diagram propped on a bench or blu-tacked to glass does not comply.',
    maxPenaltyUnits: 30,
    verified: 'reprint-2c-2012',
  },
  {
    section: '34',
    part: 'Part 4 — Evacuation planning, instruction and practice',
    heading: 'Appointment of fire safety advisers for high occupancy buildings',
    duty: ['occupier'],
    requires:
      'The occupier of a high occupancy building appoints someone holding a current building fire safety qualification as the fire safety adviser, and one person may hold the role for several such buildings. Their details then have to appear in the fire and evacuation plan.',
    maxPenaltyUnits: 30,
    verified: 'reprint-2c-2012',
  },
  {
    section: '43',
    part: 'Part 4 — Evacuation planning, instruction and practice',
    heading: 'Evacuation practice—budget accommodation buildings',
    duty: ['occupier'],
    requires:
      'A budget accommodation building is evacuated in accordance with its own fire and evacuation plan at intervals of not more than a year. No allowance for simulation here, unlike the general provision for other buildings.',
    maxPenaltyUnits: 30,
    verified: 'reprint-2c-2012',
  },
  {
    section: '44',
    part: 'Part 4 — Evacuation planning, instruction and practice',
    heading: 'Evacuation practice—other buildings',
    duty: ['occupier'],
    requires:
      'Every other building is evacuated yearly too, but by an appropriate number of people and in an appropriate way, judged against who would actually need to get out. That is what allows a hospital intensive care unit to satisfy the section by simulation rather than by moving patients.',
    maxPenaltyUnits: 30,
    verified: 'reprint-2c-2012',
  },
  {
    section: '45',
    part: 'Part 4 — Evacuation planning, instruction and practice',
    heading: 'Fire and evacuation instruction record',
    duty: ['occupier'],
    requires:
      'A record is kept for each occasion instructions are given, stating who was instructed, who gave the instructions, the date, and a brief description of what was given.',
    maxPenaltyUnits: 20,
    verified: 'reprint-2c-2012',
  },
  {
    section: '46',
    part: 'Part 4 — Evacuation planning, instruction and practice',
    heading: 'Evacuation practice record',
    duty: ['occupier'],
    requires:
      'A record of each evacuation stating the date, the times it started and ended, and any action to be taken as a result — such as reviewing the plan or giving further instructions. The action column is the part that gets left blank and the part an inspector reads.',
    maxPenaltyUnits: 20,
    verified: 'reprint-2c-2012',
  },
  {
    section: '48',
    part: 'Part 4 — Evacuation planning, instruction and practice',
    heading: 'Signs to be displayed in accommodation units',
    duty: ['owner'],
    requires:
      'The owner of a hotel room, serviced apartment or similar unit displays a sign in it showing the routes out, the firefighting equipment and manual alarms in and near the unit, and the evacuation procedures — conspicuously placed and securely attached. The obligation is the owner’s, not the occupier’s, which is unusual in this regulation.',
    maxPenaltyUnits: 30,
    verified: 'reprint-2c-2012',
  },
  {
    section: '49',
    part: 'Part 5 — Prescribed fire safety installations',
    heading: 'Meaning of critical defect',
    duty: [],
    requires:
      'The Queensland critical defect test, and it has two limbs that both have to be satisfied. Note what it actually asks: whether the defect is LIKELY to render the installation inoperable, and whether it is REASONABLY LIKELY to have a significant adverse impact on occupant safety in a fire. It is a test about likelihood, not about certainty, and it is not the same test as AS 1851’s — a defect can be an AS 1851 critical defect without being a Queensland one, and the statutory notice hangs on the Queensland one.',
    text:
      'A defect in a prescribed fire safety installation for a building is a critical defect if—(a) the defect is likely to render the installation inoperable; and (b) the defect is reasonably likely to have a significant adverse impact on the safety of occupants of part or all of the building if a fire or hazardous materials emergency happens.',
    appFeature: 'work/defects',
    verified: 'current-consolidation',
  },
  {
    section: '50',
    part: 'Part 5 — Prescribed fire safety installations',
    heading: 'Maintenance of prescribed fire safety installations—QDC, part MP6.1',
    duty: ['maintainer'],
    requires:
      'The obligation on the person actually doing the work: maintenance of a prescribed fire safety installation must be carried out in compliance with QDC part MP 6.1. This is the section that binds a technician personally, as distinct from section 54 which binds the occupier.',
    text:
      '(1) This section applies to a person carrying out maintenance of a prescribed fire safety installation. (2) The person must carry out the maintenance of the installation in compliance with QDC, part MP6.1.',
    maxPenaltyUnits: 30,
    appFeature: 'work/reports',
    verified: 'reprint-2c-2012',
  },
  {
    section: '53',
    part: 'Part 5 — Prescribed fire safety installations',
    heading: 'Notifying critical defects',
    duty: ['maintainer'],
    requires:
      'Where the person carrying out maintenance becomes aware, or ought reasonably to be aware, of a critical defect, they must give the occupier a critical defect notice in the approved form within 24 hours after carrying out the maintenance. Two things bite here: the clock runs from the maintenance, not from when the defect was noticed or the report was written; and "ought reasonably to be aware" means a defect that should have been found counts as one that was.',
    text:
      '(1) This section applies if a person who is carrying out, or has carried out, maintenance of a prescribed fire safety installation for a building, becomes aware, or ought reasonably to be aware, of a critical defect in the installation. (2) The person must give the occupier of the building a notice about the defect in the approved form (a critical defect notice) within 24 hours after the person carries out the maintenance of the installation.',
    maxPenaltyUnits: 30,
    appFeature: 'work/defects',
    verified: 'current-consolidation',
  },
  {
    section: '54',
    part: 'Part 5 — Prescribed fire safety installations',
    heading: 'Maintenance of prescribed fire safety installations',
    duty: ['occupier'],
    requires:
      'Three separate duties on the occupier: have the maintenance done by an appropriately qualified person, have each installation inspected and tested at the intervals QDC MP 6.1 requires, and — where the record of maintenance shows repair or corrective action is required — have it done within one month of the maintenance, unless there is a reasonable excuse. The one month runs from the maintenance date, not from the date the report was issued or read.',
    elements: [
      { para: '(1)', requires: 'Maintenance is carried out by an appropriately qualified person.' },
      { para: '(2)', requires: 'Each installation is inspected and tested at intervals complying with QDC part MP 6.1.' },
      { para: '(3)', requires: 'Applies subsection (4) where the record of maintenance shows repair or other corrective action is required.' },
      { para: '(4)', requires: 'The repair or corrective action is carried out no later than one month after the maintenance was carried out, unless the occupier has a reasonable excuse — the regulation gives remoteness and delay in obtaining parts as examples.' },
    ],
    text:
      '(4) The occupier of the building must ensure the repair is carried out or the corrective action is taken no later than 1 month after the maintenance of the installation was carried out, unless the occupier has a reasonable excuse.',
    maxPenaltyUnits: 30,
    appFeature: 'work/defects',
    verified: 'current-consolidation',
  },
  {
    section: '55',
    part: 'Part 5 — Prescribed fire safety installations',
    heading: 'Keeping record of maintenance',
    duty: ['occupier'],
    requires:
      'The field list an inspector works through. A record of maintenance has to state all of subsection (2), and must also include the signed certification in subsection (3)(a) and — this is the one most often missed — any critical defect notice the occupier has been given about an installation mentioned in the record. A form with perfect test results and no licence number fails this section, and so does one with a critical defect notice sitting in a separate folder.',
    elements: [
      { para: '(2)(a)', requires: 'A description of the installation the maintenance was carried out on.' },
      { para: '(2)(b)', requires: 'Where an appropriately qualified person did the work, their name and licence number.' },
      { para: '(2)(c)', requires: 'Where the work was not done personally by an appropriately qualified person, the name and licence number of the qualified person who personally supervised it.' },
      { para: '(2)(d)', requires: 'The date the maintenance was carried out.' },
      { para: '(2)(e)', requires: 'A brief description of the maintenance carried out.' },
      { para: '(2)(f)', requires: 'That the maintenance was carried out in compliance with QDC part MP 6.1.' },
      { para: '(2)(g)', requires: 'The results of the maintenance, comprising the three items below.' },
      { para: '(2)(g)(i)', requires: 'Whether the person considered the installation was in proper working order.' },
      { para: '(2)(g)(ii)', requires: 'Details of any repair or other corrective action the person considered was required.' },
      { para: '(2)(g)(iii)', requires: 'Details, including the date, of any repairs made or other corrective action taken.' },
      { para: '(3)(a)', requires: 'A statement signed by the person who carried out the maintenance certifying that the matters stated under subsection (2) are correct.' },
      { para: '(3)(b)', requires: 'Where the occupier has been given a critical defect notice about an installation mentioned in the record, that notice itself.' },
    ],
    maxPenaltyUnits: 20,
    appFeature: 'work/reports',
    verified: 'reprint-2c-2012',
  },
  {
    section: '55A',
    part: 'Part 5 — Prescribed fire safety installations',
    heading: 'Occupier statements',
    duty: ['occupier'],
    requires:
      'The occupier prepares an occupier statement at the intervals QDC MP 6.1 sets, keeps a copy with the record of maintenance for two years, and gives the commissioner a copy within 10 business days. Read subsection (3) carefully: the 10 business days run from when the occupier IS REQUIRED to prepare the statement — which under MP 6.1 is within a year of the last one — and not from the day it was actually signed. An occupier who signs late does not get a later deadline for the commissioner’s copy.',
    elements: [
      { para: '(1)', requires: 'Prepare an occupier statement complying with QDC part MP 6.1, at the intervals that part sets.' },
      { para: '(2)', requires: 'Keep a copy of each statement with the record of maintenance for two years after the statement is prepared.' },
      { para: '(3)', requires: 'Give the commissioner a copy within 10 business days after the occupier is required to prepare the statement.' },
    ],
    text:
      '(3) The occupier must, within 10 business days after the occupier is required to prepare an occupier statement, give the commissioner a copy of the statement.',
    maxPenaltyUnits: 20,
    appFeature: 'occupier',
    verified: 'current-consolidation',
  },
  {
    section: '55B',
    part: 'Part 5 — Prescribed fire safety installations',
    heading: 'Record keeping requirements for occupiers of particular buildings',
    duty: ['occupier'],
    requires:
      'For budget accommodation buildings and buildings used for residential services that need a fire safety management plan, the record of maintenance and the occupier statements have to be kept WITH that plan. On those sites the paperwork lives in a particular place, and leaving it in the panel cupboard is its own breach.',
    maxPenaltyUnits: 20,
    appFeature: 'occupier',
    verified: 'reprint-2c-2012',
  },
  {
    section: '70',
    part: 'Part 7 — Miscellaneous',
    heading: 'False or misleading documents',
    duty: ['any-person'],
    requires:
      'Nobody may give an authorised fire officer a document containing information they know is false or misleading in a material particular — and "document" expressly includes a record of maintenance and records required under a standard called up by QDC MP 6.1. This is the section that makes an inflated service report a criminal matter rather than a commercial one, and it is the reason this app refuses to record a result it did not actually get.',
    maxPenaltyUnits: 30,
    appFeature: 'work/reports',
    verified: 'reprint-2c-2012',
  },
  {
    section: '71',
    part: 'Part 7 — Miscellaneous',
    heading: 'Keeping plans and other particular documents',
    duty: ['owner', 'occupier'],
    requires:
      'A copy of the plan or prescribed document is kept in the building where a fire is not likely to destroy it, AND a second copy is kept securely in other premises. Where a copy is electronic it has to be readily accessible and usable at that place. It is the clause behind "leave a hardcopy on site" surviving into an era of cloud records.',
    maxPenaltyUnits: 20,
    appFeature: 'work/reports',
    verified: 'reprint-2c-2012',
  },
  {
    section: '72',
    part: 'Part 7 — Miscellaneous',
    heading: 'Retention and transfer of prescribed documents',
    duty: ['occupier'],
    requires:
      'A prescribed document — which includes the record of maintenance — is kept for at least two years from when it was made, or from the last day an entry was made in it. The duty runs with the building rather than the person: an incoming occupier inherits the obligation, and an outgoing one has to hand the documents over within a month of leaving.',
    maxPenaltyUnits: 20,
    appFeature: 'work/reports',
    verified: 'reprint-2c-2012',
  },
  {
    section: '85',
    part: 'Part 9 — Transitional provisions',
    heading: 'Particular persons taken to be appropriately qualified persons',
    duty: [],
    requires:
      'SPENT. It let a current Fire Protection Industry Board certificate of accreditation stand in for a licence, and by its own terms that ended on 1 January 2011. Indexed because those certificates are still produced on site as evidence of qualification, and they no longer answer section 54(1) — the definition of appropriately qualified person in the dictionary does.',
    verified: 'reprint-2c-2012',
  },
];

/** Sections that once existed and no longer do, with why. */
export const BFSR_REPEALED: Record<string, string> = {
  '51': 'Repealed by 2008 SL No. 413. Division 2 of Part 5 runs 50, then 53 — a citation to s.51 cites nothing.',
  '52': 'Repealed by 2008 SL No. 413. Division 2 of Part 5 runs 50, then 53 — a citation to s.52 cites nothing.',
};

/**
 * Normalises how a section gets typed or spoken: "s54", "s 54", "s.54", "54",
 * "55a". Returns undefined for anything that is not a section reference at all,
 * so a caller never ends up looking up an empty string.
 */
export function normaliseBfsrSection(input: string): string | undefined {
  const cleaned = input.trim().replace(/^s(ec(tion)?)?\s*\.?\s*/i, '').toUpperCase();
  return /^[0-9]+[A-Z]?$/.test(cleaned) ? cleaned : undefined;
}

/** The indexed section, or undefined where this index does not carry it. */
export function bfsrSection(input: string): BfsrSection | undefined {
  const section = normaliseBfsrSection(input);
  if (!section) return undefined;
  return BFSR_2008.find((s) => s.section === section);
}

/**
 * What is known about a section number.
 *
 * `not-indexed` is deliberately not `unknown-so-probably-fine`: it means this
 * index does not carry the section, which may be because it exists and nobody
 * needed it here, or because it never existed. The caller is told that rather
 * than being handed a confident answer either way.
 */
export type BfsrSectionStatus = 'in-force' | 'repealed' | 'not-indexed' | 'not-a-section';

export function bfsrSectionStatus(input: string): BfsrSectionStatus {
  const section = normaliseBfsrSection(input);
  if (!section) return 'not-a-section';
  if (BFSR_REPEALED[section]) return 'repealed';
  return BFSR_2008.some((s) => s.section === section) ? 'in-force' : 'not-indexed';
}

/** What one lettered element of a section requires, or undefined. */
export function bfsrElement(sectionInput: string, para: string): BfsrElement | undefined {
  return bfsrSection(sectionInput)?.elements?.find((e) => e.para === para);
}

/** Where an indexed section's text came from, and what it is worth. */
export function bfsrSectionSource(input: string): { source: string; asAt: string; confidence: NoteConfidence } | undefined {
  const section = bfsrSection(input);
  return section ? BFSR_VERIFICATION[section.verified] : undefined;
}

/**
 * The two limbs of the section 49 test, split out so an app can ask them one at
 * a time.
 *
 * Both are questions about likelihood. A technician answering "does this render
 * the installation inoperable" as a question of certainty will under-report,
 * which is why the wording here keeps the regulation's own modality.
 */
export const CRITICAL_DEFECT_TEST = {
  section: '49',
  limbA: 'Is the defect likely to render the installation inoperable?',
  limbB:
    'Is the defect reasonably likely to have a significant adverse impact on the safety of occupants of part or all of the building if a fire or hazardous materials emergency happens?',
  bothRequired: true,
  note:
    'Both limbs must be satisfied. This is not the AS 1851 critical defect test and the two are kept separate — the statutory notice under section 53 hangs on this one.',
} as const;

/**
 * The regulation's own worked examples, reproduced. Crown material.
 *
 * The negative example is the more useful of the two on site: one dead
 * extinguisher out of several in a part of a building is expressly NOT a
 * critical defect, which is exactly the call a technician gets wrong under time
 * pressure.
 */
export const CRITICAL_DEFECT_EXAMPLES = {
  section: '49',
  areCritical: [
    'a defect making a fire detection and alarm system inoperable',
    'a defect in a pump making the fire hydrants for a building inoperable',
  ],
  areNotCritical: [
    'a defect that makes inoperable only 1 of several standard fire extinguishers in a part of a building',
  ],
} as const;

export interface BfsrDefinition {
  term: string;
  /** Where the definition lives: "schedule 3", "section 47". */
  source: string;
  meaning: string;
  note?: string;
}

/**
 * The dictionary entries that decide arguments on site.
 *
 * Only the ones that change what somebody has to do. "Appropriately qualified
 * person" and "maintenance" between them decide whether a visit was lawful and
 * whether it counted, and both are narrower than the trade usually assumes.
 */
export const BFSR_DEFINITIONS: BfsrDefinition[] = [
  {
    term: 'appropriately qualified person',
    source: 'schedule 3',
    meaning:
      'A person holding a licence of a class, type or endorsement named in the plumbing and drainage or building services regulations, whose scope of work includes maintaining installations of that type. Water-based installations — sprinklers and hydrants including boosters — are licensed differently from everything else.',
    note:
      'The scope-of-work limb is the one that bites: holding a licence is not enough if it does not cover the installation being worked on.',
  },
  {
    term: 'maintenance',
    source: 'schedule 3',
    meaning:
      'For a prescribed fire safety installation, the inspection and testing, or repair, necessary to ensure it continues to operate at its original performance level and in accordance with any relevant Australian Standards.',
    note:
      '"Original performance level" is the benchmark, which is why a missing baseline or commissioning record is a real problem and not just untidy filing.',
  },
  {
    term: 'water-based fire safety installation',
    source: 'schedule 3',
    meaning:
      'A prescribed fire safety installation consisting of sprinklers, including wall-wetting sprinklers, or fire hydrants, including hydrant boosters.',
    note: 'The category that determines which licence class an appropriately qualified person needs.',
  },
  {
    term: 'prescribed document',
    source: 'schedule 3',
    meaning:
      'A record of a review of a fire and evacuation plan, a fire and evacuation instruction record, an evacuation practice record, or a record of maintenance.',
    note: 'These are the documents the two-year retention and the hand-over duty in section 72 attach to.',
  },
  {
    term: 'prescribed fire safety installation',
    source: 'schedule 3, by reference to the Fire Services Act 1990',
    meaning:
      'Defined by reference to the Fire Services Act rather than by a list inside this regulation. The working list of what has to be maintained comes from QDC MP 6.1, which is also what the occupier statement enumerates.',
  },
  {
    term: 'obstruct',
    source: 'schedule 3',
    meaning:
      'In relation to an evacuation route, includes hindering a person’s use of the route. It is broader than blocking it — something that merely slows people down can obstruct.',
  },
  {
    term: 'occupier statement',
    source: 'section 55A(1)',
    meaning:
      'A statement the occupier prepares, at the intervals QDC MP 6.1 sets, about the maintenance of each prescribed fire safety installation for the building.',
  },
  {
    term: 'record of maintenance',
    source: 'schedule 3, by reference to section 55(1)',
    meaning: 'The record the occupier must keep for the maintenance of each prescribed fire safety installation.',
  },
];

/** A dictionary entry, or undefined where the term is not indexed. */
export function bfsrDefinition(term: string): BfsrDefinition | undefined {
  const wanted = term.trim().toLowerCase();
  return BFSR_DEFINITIONS.find((d) => d.term === wanted);
}
