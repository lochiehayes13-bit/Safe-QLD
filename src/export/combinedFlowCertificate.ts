import { overloadCheck, type OverloadCheck } from '@/domain/form72';
import { formatAuDate } from './sheets';

/**
 * The annual combined sprinkler and hydrant flow test certificate.
 *
 * Where a building has both systems fed from one supply, they cannot honestly
 * be certified apart: the hydrants and the sprinklers draw from the same water
 * at the same time, and a hydrant test run with the sprinklers isolated proves
 * something that will not happen in a fire. So the duty this certifies is the
 * combined one — hydrant flow at full duty plus the sprinkler demand — and the
 * form is built around that sum rather than around two separate results.
 *
 * It is read alongside Queensland's Form 70 under QDC MP 6.1, and it is a house
 * document rather than a statutory form, which means the layout can be improved
 * where the paper version is weak. Two places it is:
 *
 * The pump overload result is computed rather than transcribed. Testing a pump
 * at its rated duty proves very little — one on the way out still makes its
 * number at the easy end of the curve. The test that finds it runs 150% of duty
 * flow and requires 65% of duty pressure, and that arithmetic is done here so a
 * certificate cannot state a pass its own figures do not support.
 *
 * And a gauge's calibration is shown against the test date rather than beside
 * it. Every pressure on the page was read with those gauges; one out of
 * calibration makes all of them unusable, and a reader comparing two dates in
 * different table columns will not notice.
 */

function esc(s: string | number | undefined | null): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface FlowTestEquipment {
  item: string;
  model?: string;
  idNumber?: string;
  /** ISO date. */
  certificationDate?: string;
  certificationReference?: string;
}

export interface CombinedTestPoint {
  label: string;
  location?: string;
  /** Above or below ground, feed or attack — as the paper form records it. */
  aboveOrBelowGround?: 'above' | 'below';
  feedOrAttack?: 'feed' | 'attack';
}

export interface CombinedFlowInput {
  buildingName: string;
  buildingAddress?: string;
  occupierRepresentative?: string;
  contactPhone?: string;
  email?: string;
  /** ISO date. */
  testDate?: string;
  testTime?: string;
  buildingClass?: string;
  buildingArea?: string;
  buildingHeightM?: number;
  applicableStandards?: string;
  standardYear?: string;
  yearOfDesign?: string;
  yearOfInstallation?: string;

  /** Hydrant duty from the block plan. */
  hydrantFlowLps?: number;
  hydrantPressureKpa?: number;
  hydrantsSimultaneous?: number;
  /** Sprinkler classification: Res, ELH, OH, EHH. */
  sprinklerClassification?: string;
  sprinklerFlowLpm?: number;
  sprinklerHeadHeightM?: number;

  staticAtMostDisadvantagedKpa?: number;
  staticAtBoosterKpa?: number;
  staticAtPumpDischargeKpa?: number;
  pressureZone?: string;

  /** What the test actually achieved at 100% and at 150% of duty. */
  achievedAt100?: { flowLps: number; residualKpa: number };
  achievedAt150?: { flowLps: number; residualKpa: number };

  equipment: FlowTestEquipment[];
  testPoints: CombinedTestPoint[];
  mostDisadvantagedLocation?: string;
  sprinklerFlowDeviceLocation?: string;

  testedBy: string;
  licenceNumber?: string;
  position?: string;
  company?: string;
  comments?: string;
}

export interface CombinedFlowAssessment {
  /** The combined duty the system has to make: hydrants plus sprinklers. */
  combinedLps?: number;
  overload?: OverloadCheck;
  /** Gauges whose calibration does not cover the test date. */
  staleEquipment: string[];
  warnings: string[];
  /** Undefined where the figures do not support a verdict either way. */
  passed?: boolean;
}

/** A test gauge is normally calibrated every twelve months. */
const CALIBRATION_MONTHS = 12;

const parse = (s?: string): number | undefined => {
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
};

/**
 * What the certificate's own figures say, before anybody signs it.
 *
 * Deliberately returns an undefined verdict rather than a pass where the
 * numbers do not reach. A certificate is a statement by a licensed person, and
 * one that says "pass" because a field was blank is worse than one that says
 * nothing at all.
 */
export function assessCombinedFlow(input: CombinedFlowInput): CombinedFlowAssessment {
  const warnings: string[] = [];
  const staleEquipment: string[] = [];

  const testAt = parse(input.testDate);
  for (const e of input.equipment) {
    if (!e.idNumber && !e.model) continue;
    const name = `${e.item}${e.idNumber ? ` (${e.idNumber})` : ''}`;
    const calAt = parse(e.certificationDate);
    if (calAt === undefined) {
      warnings.push(`${name} has no calibration date. Every pressure on this page was read with it.`);
      continue;
    }
    if (testAt === undefined) continue;
    if (calAt > testAt) {
      warnings.push(`${name} shows a calibration date after the test date. One of the two is wrong.`);
      continue;
    }
    const months = (testAt - calAt) / (1000 * 60 * 60 * 24 * 30.44);
    if (months > CALIBRATION_MONTHS) {
      staleEquipment.push(name);
      warnings.push(
        `${name} was last calibrated ${Math.floor(months)} months before the test. Every pressure `
        + 'on this certificate was read with it, so none of them can be relied on.',
      );
    }
  }

  /*
   * The sprinkler demand is quoted in litres per minute and the hydrant duty in
   * litres per second, on the same page, because that is how each trade writes
   * its own figure. Adding them without converting is the arithmetic slip this
   * certificate is most likely to carry.
   */
  const combinedLps = input.hydrantFlowLps !== undefined && input.sprinklerFlowLpm !== undefined
    ? Math.round((input.hydrantFlowLps + input.sprinklerFlowLpm / 60) * 100) / 100
    : input.hydrantFlowLps;

  const overload = combinedLps !== undefined && input.hydrantPressureKpa !== undefined
    ? overloadCheck(
      combinedLps,
      input.hydrantPressureKpa,
      input.achievedAt150
        ? { flowLps: input.achievedAt150.flowLps, pressureKpa: input.achievedAt150.residualKpa }
        : undefined,
    )
    : undefined;

  if (input.achievedAt100 && combinedLps !== undefined
    && input.achievedAt100.flowLps + 0.001 < combinedLps) {
    warnings.push(
      `The 100% run reached ${input.achievedAt100.flowLps} L/s against a combined duty of `
      + `${combinedLps} L/s, so the system did not make its duty before the overload run was `
      + 'considered at all.',
    );
  }

  if (!input.hydrantFlowLps || !input.hydrantPressureKpa) {
    warnings.push(
      'No hydrant duty from the block plan, so there is nothing to test against. The block plan at '
      + 'the booster is where this figure comes from.',
    );
  }

  const madeDuty = input.achievedAt100 !== undefined && combinedLps !== undefined
    && input.achievedAt100.flowLps + 0.001 >= combinedLps;
  const madeOverload = overload?.achieved;

  const passed = madeDuty === undefined || madeOverload === undefined
    ? undefined
    : madeDuty && madeOverload && !staleEquipment.length;

  return { combinedLps, overload, staleEquipment, warnings, passed };
}

const CSS = `
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 10.5px; color: #1b1b1b; margin: 0; }
  h1 { font-size: 15px; text-align: center; margin: 0 0 3px; letter-spacing: 0.4px; text-transform: uppercase; }
  .sub { text-align: center; font-size: 10px; color: #444; margin: 0 0 14px; }
  h2 { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; background: #1b3a63;
       color: #fff; padding: 5px 8px; margin: 16px 0 0; }
  table { width: 100%; border-collapse: collapse; }
  td, th { border: 1px solid #aab; padding: 4px 6px; vertical-align: top; font-size: 9.5px; }
  th { background: #eef2f7; text-align: left; font-weight: bold; }
  .k { background: #f5f7fa; font-weight: bold; width: 34%; }
  .note { border: 1px solid #999; background: #f7f7f7; padding: 7px 9px; margin: 10px 0;
          font-size: 9px; line-height: 1.5; }
  .fail { color: #a11; font-weight: bold; }
  .pass { color: #161; font-weight: bold; }
  .foot { margin-top: 14px; font-size: 8.5px; color: #444; line-height: 1.5; }
`;

const row = (k: string, v: string | number | undefined) =>
  v === undefined || v === '' ? '' : `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`;

export function combinedFlowCertificateHtml(input: CombinedFlowInput): string {
  const a = assessCombinedFlow(input);
  const company = input.company || 'Safe QLD Fire Protection';

  const verdict = a.passed === true
    ? '<span class="pass">Flow test PASSED</span>'
    : a.passed === false
      ? '<span class="fail">Flow test FAILED</span>'
      : '<span>Not determined from the figures recorded</span>';

  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>${CSS}</style></head><body>
    <h1>Annual Combined Sprinkler &amp; Hydrant Flow Test Certificate</h1>
    <div class="sub">${esc(company)}${input.licenceNumber ? ` · Licence ${esc(input.licenceNumber)}` : ''}</div>

    <h2>Building</h2>
    <table>
      ${row('Building name', input.buildingName)}
      ${row('Building address', input.buildingAddress)}
      ${row('Owner / occupier representative', input.occupierRepresentative)}
      ${row('Contact', [input.contactPhone, input.email].filter(Boolean).join(' · ') || undefined)}
      ${row('Building class', input.buildingClass)}
      ${row('Building / compartment area', input.buildingArea)}
      ${row('Height of building', input.buildingHeightM !== undefined ? `${input.buildingHeightM} m` : undefined)}
      ${row('Applicable standards', input.applicableStandards)}
      ${row('Year of standard', input.standardYear)}
      ${row('Year of design', input.yearOfDesign)}
      ${row('Year of installation', input.yearOfInstallation)}
      ${row('Test date', formatAuDate(input.testDate) || undefined)}
      ${row('Time of test', input.testTime)}
    </table>

    <h2>Performance required</h2>
    <table>
      ${row('Hydrant flow from block plan', input.hydrantFlowLps !== undefined ? `${input.hydrantFlowLps} L/s @ ${input.hydrantPressureKpa ?? '—'} kPa` : undefined)}
      ${row('Hydrants required to flow simultaneously', input.hydrantsSimultaneous)}
      ${row('Sprinkler classification', input.sprinklerClassification)}
      ${row('Sprinkler flow', input.sprinklerFlowLpm !== undefined ? `${input.sprinklerFlowLpm} L/min` : undefined)}
      ${row('Sprinkler head height', input.sprinklerHeadHeightM !== undefined ? `${input.sprinklerHeadHeightM} m` : undefined)}
      ${row('Combined duty', a.combinedLps !== undefined ? `${a.combinedLps} L/s` : undefined)}
      ${row('Pressure zone', input.pressureZone)}
    </table>
    ${input.sprinklerFlowLpm !== undefined ? `<div class="note">
      The sprinkler demand is quoted in litres per minute and the hydrant duty in litres per second.
      The combined duty above converts before adding — the two are not interchangeable and adding
      them as written overstates the duty sixtyfold.
    </div>` : ''}

    ${a.overload ? `<h2>Pump overload requirement</h2>
    <div class="note">${esc(a.overload.note)}</div>` : ''}

    <h2>Static pressures</h2>
    <table>
      ${row('At most disadvantaged hydrant', input.staticAtMostDisadvantagedKpa !== undefined ? `${input.staticAtMostDisadvantagedKpa} kPa` : undefined)}
      ${row('At hydrant booster', input.staticAtBoosterKpa !== undefined ? `${input.staticAtBoosterKpa} kPa` : undefined)}
      ${row('At pump discharge', input.staticAtPumpDischargeKpa !== undefined ? `${input.staticAtPumpDischargeKpa} kPa` : undefined)}
      ${row('Location of most disadvantaged hydrant', input.mostDisadvantagedLocation)}
      ${row('Location of sprinkler flow device', input.sprinklerFlowDeviceLocation)}
    </table>

    <h2>Combined flow test results</h2>
    <table>
      <tr><th>Run</th><th>Flow achieved</th><th>Residual pressure</th><th>Required</th></tr>
      <tr>
        <td>100% duty</td>
        <td>${input.achievedAt100 ? esc(`${input.achievedAt100.flowLps} L/s`) : '—'}</td>
        <td>${input.achievedAt100 ? esc(`${input.achievedAt100.residualKpa} kPa`) : '—'}</td>
        <td>${a.combinedLps !== undefined ? esc(`${a.combinedLps} L/s @ ${input.hydrantPressureKpa ?? '—'} kPa`) : '—'}</td>
      </tr>
      <tr>
        <td>150% duty</td>
        <td>${input.achievedAt150 ? esc(`${input.achievedAt150.flowLps} L/s`) : '—'}</td>
        <td>${input.achievedAt150 ? esc(`${input.achievedAt150.residualKpa} kPa`) : '—'}</td>
        <td>${a.overload ? esc(`${a.overload.requiredFlowLps} L/s @ ${a.overload.requiredPressureKpa} kPa`) : '—'}</td>
      </tr>
    </table>

    ${input.testPoints.length ? `<h2>Test points</h2>
    <table>
      <tr><th>Point</th><th>Location</th><th>Above / below ground</th><th>Feed / attack</th></tr>
      ${input.testPoints.map((p) => `<tr>
        <td>${esc(p.label)}</td><td>${esc(p.location)}</td>
        <td>${esc(p.aboveOrBelowGround)}</td><td>${esc(p.feedOrAttack)}</td>
      </tr>`).join('')}
    </table>` : ''}

    ${input.equipment.length ? `<h2>Test equipment</h2>
    <table>
      <tr><th>Item</th><th>Model</th><th>ID no.</th><th>Certified</th><th>Reference</th></tr>
      ${input.equipment.map((e) => {
    const stale = a.staleEquipment.some((s) => s.startsWith(e.item));
    return `<tr>
        <td>${esc(e.item)}</td><td>${esc(e.model)}</td><td>${esc(e.idNumber)}</td>
        <td${stale ? ' class="fail"' : ''}>${esc(formatAuDate(e.certificationDate))}</td>
        <td>${esc(e.certificationReference)}</td>
      </tr>`;
  }).join('')}
    </table>` : ''}

    ${a.warnings.length ? `<div class="note"><b>Before this is signed</b><br />${
  a.warnings.map((w) => esc(w)).join('<br />')
}</div>` : ''}

    <h2>Result</h2>
    <table>
      ${row('Combined flow test', undefined)}
      <tr><td class="k">Outcome</td><td>${verdict}</td></tr>
      ${row('Comments', input.comments)}
    </table>

    <h2>Certification</h2>
    <table>
      ${row('Test carried out by', input.testedBy)}
      ${row('Position', input.position)}
      ${row('Licence no.', input.licenceNumber)}
      ${row('Date', formatAuDate(input.testDate) || undefined)}
    </table>

    <p class="foot">
      This certificate records a combined sprinkler and hydrant flow test carried out in accordance
      with the relevant Australian Standards. It is to be read in conjunction with Building Codes
      Queensland Form 70 under QDC MP 6.1. Where the outcome above is not determined, the figures
      recorded do not support a result either way and the test is incomplete rather than passed.
    </p>
  </body></html>`;
}
