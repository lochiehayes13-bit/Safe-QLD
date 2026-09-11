/**
 * Findings from a fire system effectiveness assessment.
 *
 * This is a different document from a routine service report and the difference
 * is the whole point. An effectiveness assessment is visual and advisory: no
 * device is activated, no measurement is taken, and nothing found is a defect.
 * Its findings are **recommendations** — areas of improvement proposed for an
 * upcoming project — and **observations**, which are noted for the record and
 * need no action at all.
 *
 * Keeping that separation is not pedantry. A recommendation written up as a
 * defect starts statutory clocks that have no business running: a critical
 * defect in Queensland obliges notice to the occupier and a copy to the
 * Commissioner, and manufacturing one out of "this panel is superseded" is a
 * false statement to a regulator. The report Safe QLD issues is emphatic about
 * it — "these devices are NOT defective" — and so is this module: nothing here
 * has a severity, and nothing here can become a defect by accident.
 *
 * What it does carry is a priority, and only on a recommendation. An
 * observation with a priority is a contradiction — note-only work cannot be
 * urgent — and is reported as one.
 */

export type FindingKind = 'recommendation' | 'observation';

/** Priority applies to recommendations only. An observation needs no action. */
export type FindingPriority = 'high' | 'medium' | 'low';

export interface Finding {
  id: string;
  assessmentId: string;
  kind: FindingKind;
  /** 1-based within the kind, which is what R-01 and OBS-01 count. */
  seq: number;
  /** The short name of the finding: "FIP Upgrade – AFP-2800 Superseded". */
  item: string;
  location: string;
  /**
   * What the finding is measured against — a manufacturer's product status, a
   * service life, another section of the report. Blank on an observation, which
   * is measured against nothing but the original design intent.
   */
  reference?: string;
  detail: string;
  /**
   * The action row. On a recommendation this is what is proposed; on an
   * observation it is the note. Required on both, because a finding with no
   * action and no note is a sentence in a table nobody can act on.
   */
  action: string;
  priority?: FindingPriority;
  /** Other findings this one is programmed with, by reference: ["R-01"]. */
  relatedRefs: string[];
  /** Photographs in the register that show it. */
  photos: string[];
  createdAt: string;
  updatedAt: string;
}

export const KIND_LABEL: Record<FindingKind, string> = {
  recommendation: 'Recommendation',
  observation: 'Observation',
};

export const PRIORITY_LABEL: Record<FindingPriority, string> = {
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

/**
 * How each kind is defined in the report's own classification key.
 *
 * Printed with the findings register so a reader is never left to infer what a
 * classification means, and held here so the app and the document say the same
 * thing.
 */
export const KIND_MEANING: Record<FindingKind, string> = {
  recommendation:
    'Area of recommended improvement or lifecycle upgrade proposed for the upcoming project, '
    + 'assessed against the original design intent as installed. No defect exists and no design '
    + 'non-compliance is asserted.',
  observation:
    'Condition noted for the record; consistent with original design intent; no action required.',
};

/** The prefix each kind numbers under. */
const PREFIX: Record<FindingKind, string> = { recommendation: 'R', observation: 'OBS' };

/** "R-01", "OBS-03" — the reference the report and the quote both cite. */
export function findingRef(kind: FindingKind, seq: number): string {
  return `${PREFIX[kind]}-${String(seq).padStart(2, '0')}`;
}

export function parseFindingRef(ref: string): { kind: FindingKind; seq: number } | undefined {
  const m = ref.trim().toUpperCase().match(/^(R|OBS)-?(\d{1,3})$/);
  if (!m) return undefined;
  const seq = Number(m[2]);
  if (!seq) return undefined;
  return { kind: m[1] === 'R' ? 'recommendation' : 'observation', seq };
}

/**
 * Numbers the findings as the report prints them.
 *
 * Recommendations first, then observations, each sequence starting at one and
 * running without gaps. Gaps matter: a register that jumps from R-02 to R-04
 * reads as a finding removed before issue, and a client asks what it was.
 *
 * Input order is preserved within each kind, so a technician's ordering is the
 * report's ordering.
 */
export function renumber(findings: Finding[]): Finding[] {
  const counters: Record<FindingKind, number> = { recommendation: 0, observation: 0 };
  const byKind = (kind: FindingKind) => findings.filter((f) => f.kind === kind);
  return [...byKind('recommendation'), ...byKind('observation')].map((f) => {
    counters[f.kind] += 1;
    return f.seq === counters[f.kind] ? f : { ...f, seq: counters[f.kind] };
  });
}

export interface FindingsSummary {
  recommendations: number;
  observations: number;
  high: number;
  /** True when nothing was found at all, which is a legitimate outcome. */
  none: boolean;
}

export function summariseFindings(findings: Finding[]): FindingsSummary {
  const recommendations = findings.filter((f) => f.kind === 'recommendation');
  return {
    recommendations: recommendations.length,
    observations: findings.filter((f) => f.kind === 'observation').length,
    high: recommendations.filter((f) => f.priority === 'high').length,
    none: findings.length === 0,
  };
}

export interface FindingIssue {
  findingId?: string;
  message: string;
}

/**
 * What the office sends back.
 *
 * Checked on the phone before the report is issued, because a query a week
 * later costs more than a warning now — and because two of these are not
 * cosmetic. An observation carrying a priority contradicts what an observation
 * is, and a reference pointing at a finding that does not exist puts a dangling
 * cross-reference in a document a client reads.
 */
export function validateFindings(findings: Finding[]): FindingIssue[] {
  const issues: FindingIssue[] = [];
  const refs = new Set(findings.map((f) => findingRef(f.kind, f.seq)));

  for (const f of findings) {
    const ref = findingRef(f.kind, f.seq);
    if (!f.item.trim()) issues.push({ findingId: f.id, message: `${ref} has no item name.` });
    if (!f.detail.trim()) issues.push({ findingId: f.id, message: `${ref} has no detail.` });
    if (!f.action.trim()) {
      issues.push({
        findingId: f.id,
        message: f.kind === 'recommendation'
          ? `${ref} recommends something but does not say what to do about it.`
          : `${ref} has no note, so the register would print an empty row.`,
      });
    }
    if (!f.location.trim()) issues.push({ findingId: f.id, message: `${ref} has no location.` });

    if (f.kind === 'observation' && f.priority) {
      issues.push({
        findingId: f.id,
        message: `${ref} is an observation with a ${PRIORITY_LABEL[f.priority]} priority. `
          + 'An observation is note-only and needs no action, so it cannot carry one.',
      });
    }
    if (f.kind === 'recommendation' && !f.priority) {
      issues.push({ findingId: f.id, message: `${ref} has no priority set.` });
    }

    for (const related of f.relatedRefs) {
      if (!parseFindingRef(related)) {
        issues.push({ findingId: f.id, message: `${ref} cites "${related}", which is not a finding reference.` });
      } else if (!refs.has(findingRef(parseFindingRef(related)!.kind, parseFindingRef(related)!.seq))) {
        issues.push({
          findingId: f.id,
          message: `${ref} cites ${related}, which is not in this report. A client reading it finds nothing there.`,
        });
      } else if (related.toUpperCase().replace('-', '') === ref.replace('-', '')) {
        issues.push({ findingId: f.id, message: `${ref} cites itself.` });
      }
    }
  }

  const seen = new Set<string>();
  for (const f of findings) {
    const ref = findingRef(f.kind, f.seq);
    if (seen.has(ref)) issues.push({ findingId: f.id, message: `${ref} is used twice.` });
    seen.add(ref);
  }

  return issues;
}

/**
 * The closing statement's list of recommendations.
 *
 * The issued report ends by enumerating what the project should incorporate —
 * "(1) replacement of the FIP; (2) programmed replacement of the detection
 * fleet; (3) installation of 3 speakers". Written by hand that list drifts out
 * of step with the register above it, and a report that recommends five things
 * and lists three is the kind of error nobody catches until a scope is quoted
 * short.
 *
 * Built from the register instead, so the two cannot disagree.
 */
export function recommendationList(findings: Finding[]): string {
  const items = findings
    .filter((f) => f.kind === 'recommendation')
    .map((f, i) => `(${i + 1}) ${f.item.trim().replace(/[.;]$/, '')}`);
  return items.join('; ');
}

/**
 * What an effectiveness report may never say about itself.
 *
 * Held as data rather than as prose inside the HTML so it is one statement in
 * one place: the app, the report and any future export cannot drift into
 * describing this document as something it is not.
 */
export const NOT_A_SERVICE_RECORD =
  'This report is an advisory readiness assessment only. It does not constitute an AS 1851:2012 '
  + 'routine service record, inspection report, condition report or certificate of compliance, and '
  + 'does not replace the routine servicing obligations applying to the site under QDC MP6.1 and '
  + 'the Building Fire Safety Regulation 2008.';

export const NO_TESTING_CONDUCTED =
  'No inspection, testing or survey activities under AS 1851:2012 were undertaken at this '
  + 'attendance. No devices were activated, no tones were generated, no battery, sound pressure '
  + 'level, impedance or sensitivity measurements were taken, and no system functions were '
  + 'operated. Findings are based on visual observation and information displayed on the day.';

export const NOT_A_DESIGN_REVIEW =
  'This is not an engineered design investigation, fire engineering assessment or design '
  + 'compliance review against AS 1670.1 or any other design standard. No design verification, '
  + 'calculations or acoustic assessment were performed. The baseline for all commentary is the '
  + 'original design intent of the installed system as shown on site.';

/**
 * Whether the report's "no defects were identified" line can honestly be made.
 *
 * The statement is true of the attendance — nothing was tested, so nothing
 * failed — but a site with defects already open is a different matter, and a
 * client reading "no defects" in a report about their building will not draw
 * the distinction the scope note draws. This is the cross-check a person
 * cannot do from inside the document.
 */
export function openDefectCaution(openDefects: number, criticalOpen: number): string | undefined {
  if (openDefects <= 0) return undefined;
  const critical = criticalOpen > 0
    ? ` ${criticalOpen} of them ${criticalOpen === 1 ? 'is' : 'are'} critical.`
    : '';
  return `This site has ${openDefects} open defect${openDefects === 1 ? '' : 's'} already recorded.${critical} `
    + 'This assessment found none because it tested nothing, but a client reading "no defects were '
    + 'identified" will not make that distinction. Say so in the report or resolve them first.';
}
