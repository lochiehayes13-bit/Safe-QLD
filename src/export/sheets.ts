import type {
  CauseEffectRule,
  CheckRow,
  Defect,
  EffectKind,
  Panel,
  Point,
  ServiceReport,
  Site,
  TestRow,
  Zone,
} from '@/domain/types';
import { DEVICE_TYPE_LABEL } from '@/parsers/deviceType';
import type { Cell, Row, Sheet } from './xlsx';
import { qldDay } from '@/domain/qldTime';

/**
 * Builds the workbook layouts the app exports.
 *
 * Kept free of React and expo-file-system so each layout can be unit tested by
 * inspecting the rows it produces.
 */

const H = (s: string): Cell => ({ v: s, style: 'header' });

export function formatAuDate(iso: string | undefined): string {
  if (!iso) return '';
  /*
   * The Queensland calendar day, not the UTC one.
   *
   * Everything here is stamped as a UTC instant and read by somebody in
   * Brisbane, and between midnight and 10am those two disagree about the date.
   * A fire service that starts at seven spends the first three hours of every
   * day on the wrong side of that line, so a notice for work done on Friday
   * morning printed Thursday — on a document whose statutory clocks run from
   * that date.
   *
   * What it cannot read comes back as it arrived. A date already unreadable
   * should stay visible on the page rather than becoming an empty box that
   * nobody can trace back to a bad value.
   */
  return qldDay(iso) ?? iso;
}

function pointAddressLabel(p: { loopNumber?: number; address?: number; subAddress?: number; pointRef?: string }): string {
  if (p.loopNumber !== undefined && p.address !== undefined) {
    const base = `L${p.loopNumber}.${String(p.address).padStart(3, '0')}`;
    return p.subAddress !== undefined ? `${base}.${p.subAddress}` : base;
  }
  if (p.pointRef) return p.pointRef;
  if (p.address !== undefined) return String(p.address);
  return '';
}

// ---------------------------------------------------------------------------
// Zone and point lists
// ---------------------------------------------------------------------------

export function zoneSheet(panel: Panel, zones: Zone[]): Sheet {
  const rows: Row[] = [[H('Zone'), H('Zone text'), H('Second line'), H('Type'), H('Status')]];
  for (const z of zones) {
    rows.push([
      z.number,
      z.text,
      z.text2 ?? '',
      z.type ?? '',
      z.unused ? { v: 'Unused', style: 'muted' } : 'In use',
    ]);
  }
  return {
    name: `${panel.name} Zones`,
    rows,
    colWidths: [8, 46, 34, 16, 12],
    freezeRows: 1,
    autoFilter: true,
  };
}

export function pointSheet(panel: Panel, points: Point[]): Sheet {
  const rows: Row[] = [[
    H('Address'), H('Loop'), H('Point'), H('Sub'), H('Device text'),
    H('Second line'), H('Type'), H('Panel type'), H('Zone'), H('Zone text'), H('Status'),
  ]];
  for (const p of points) {
    rows.push([
      pointAddressLabel(p),
      p.loopNumber ?? '',
      p.address ?? '',
      p.subAddress ?? '',
      p.text,
      p.text2 ?? '',
      DEVICE_TYPE_LABEL[p.deviceType],
      p.deviceTypeRaw ?? '',
      p.zoneNumber ?? '',
      // Carrying zone text on every point row is the single most useful thing
      // on a point list: it confirms zone allocation without cross-referencing.
      p.zoneText ?? '',
      p.unused ? { v: 'Unused', style: 'muted' } : 'In use',
    ]);
  }
  return {
    name: `${panel.name} Points`,
    rows,
    colWidths: [12, 7, 8, 6, 44, 30, 16, 18, 8, 34, 10],
    freezeRows: 1,
    autoFilter: true,
  };
}

// ---------------------------------------------------------------------------
// Test report
// ---------------------------------------------------------------------------

/**
 * Untested says so.
 *
 * It printed as an empty cell, which is the one thing it must not be. "Not
 * tested" is a stated outcome in this app — a distinct result with a required
 * reason, because an inaccessible device is the commonest real outcome on an
 * annual and calling one a pass hides a coverage gap. A blank cell hides it
 * exactly as well, and on a sheet with an autofilter it hides it better: filter
 * the Result column to Pass and Fail and the blanks vanish from the count
 * without anybody deciding they should.
 */
const RESULT_LABEL: Record<TestRow['result'], string> = {
  pass: 'Pass',
  fail: 'FAIL',
  na: 'N/A',
  untested: 'NOT TESTED',
};

function resultCell(r: TestRow['result']): Cell {
  return {
    v: RESULT_LABEL[r],
    // Marked like N/A rather than left plain. Neither is a failure and neither
    // is a pass, and both are the rows somebody has to look at again.
    style: r === 'pass' ? 'pass' : r === 'fail' ? 'fail' : 'warn',
  };
}

export interface ReportBundle {
  site: Site;
  report: ServiceReport;
  panel?: Panel;
  testRows: TestRow[];
  checkRows: CheckRow[];
  defects: Defect[];
}

export function reportCoverSheet(b: ReportBundle): Sheet {
  const { site, report } = b;
  const pass = b.testRows.filter((r) => r.result === 'pass').length;
  const fail = b.testRows.filter((r) => r.result === 'fail').length;
  const na = b.testRows.filter((r) => r.result === 'na').length;
  const untested = b.testRows.filter((r) => r.result === 'untested').length;

  const rows: Row[] = [
    [{ v: report.title, style: 'title' }],
    [],
    [H('Site'), site.name],
    [H('Address'), [site.address, site.suburb, site.state, site.postcode].filter(Boolean).join(' ')],
    [H('Client'), site.clientName ?? ''],
    [H('Site reference'), site.siteRef ?? ''],
    [H('Panel'), b.panel ? `${b.panel.name}${b.panel.model ? ` (${b.panel.model})` : ''}` : 'All panels'],
    [],
    [H('Service type'), report.frequency],
    [H('Service date'), formatAuDate(report.serviceDate)],
    [H('Technician'), report.technicianName ?? ''],
    [H('Licence no.'), report.technicianLicence ?? ''],
    [H('Company'), report.companyName ?? ''],
    [H('Witnessed by'), report.witnessName ?? ''],
    [],
    [{ v: 'Results', style: 'title' }],
    /*
     * "Devices tested" counted every row, including the ones nobody tested.
     *
     * On the summary sheet of a service record that is a coverage claim the
     * body does not support: forty devices on the sheet with eight of them
     * inaccessible is thirty-two tested, and the line said forty. The routine
     * service report already counts these apart for the same reason — the
     * summary must not claim a coverage the pages behind it do not show.
     */
    [H('Devices on this report'), b.testRows.length],
    [H('Devices tested'), pass + fail],
    [H('Pass'), { v: pass, style: 'pass' }],
    [H('Fail'), { v: fail, style: fail ? 'fail' : 'default' }],
    [H('Not applicable'), na],
    [H('Not tested'), { v: untested, style: untested ? 'warn' : 'default' }],
    [H('Defects raised'), b.defects.length],
    [H('Critical defects'), { v: b.defects.filter((d) => d.severity === 'critical').length, style: 'fail' }],
  ];

  if (report.notes) {
    rows.push([], [{ v: 'Notes', style: 'title' }], [report.notes]);
  }

  return { name: 'Summary', rows, colWidths: [24, 60] };
}

export function testResultSheet(rows: TestRow[]): Sheet {
  const out: Row[] = [[
    H('#'), H('Address'), H('Zone'), H('Zone text'), H('Device text'),
    H('Type'), H('Method'), H('Result'), H('Comment'), H('Tested'),
  ]];
  rows.forEach((r, i) => {
    out.push([
      i + 1,
      pointAddressLabel(r),
      r.zoneNumber ?? '',
      r.zoneText ?? '',
      r.deviceText,
      DEVICE_TYPE_LABEL[r.deviceType],
      r.method ?? '',
      resultCell(r.result),
      r.comment ?? '',
      r.testedAt ? formatAuDate(r.testedAt) : '',
    ]);
  });
  return { name: 'Test results', rows: out, colWidths: [6, 12, 8, 32, 42, 16, 24, 10, 40, 12], freezeRows: 1, autoFilter: true };
}

export function checkSheet(rows: CheckRow[]): Sheet {
  const out: Row[] = [[H('Section'), H('Check'), H('Result'), H('Value'), H('Unit'), H('Comment')]];
  for (const r of rows) {
    out.push([
      r.section,
      r.label,
      resultCell(r.result as TestRow['result']),
      r.value ?? '',
      r.unit ?? '',
      r.comment ?? '',
    ]);
  }
  return { name: 'Panel checks', rows: out, colWidths: [24, 52, 10, 14, 10, 40], freezeRows: 1 };
}

export function defectSheet(defects: Defect[]): Sheet {
  const out: Row[] = [[H('Severity'), H('Status'), H('Location'), H('Description'), H('Raised'), H('Rectified'), H('Photos'), H('Notes')]];
  for (const d of defects) {
    out.push([
      { v: d.severity === 'critical' ? 'CRITICAL' : 'Non-critical', style: d.severity === 'critical' ? 'fail' : 'warn' },
      d.status,
      d.location,
      d.description,
      formatAuDate(d.raisedAt),
      formatAuDate(d.rectifiedAt),
      d.photos.length,
      d.notes ?? '',
    ]);
  }
  return { name: 'Defects', rows: out, colWidths: [14, 12, 34, 54, 12, 12, 8, 40], freezeRows: 1, autoFilter: true };
}

// ---------------------------------------------------------------------------
// Cause and effect matrix
// ---------------------------------------------------------------------------

export const EFFECT_LABEL: Record<EffectKind, string> = {
  'occupant-warning': 'Occupant warning',
  evacuation: 'Evacuation',
  sounders: 'Sounders',
  strobes: 'Strobes',
  'brigade-signal': 'Brigade signal (ASE)',
  'ahu-shutdown': 'AHU shutdown',
  'lift-homing': 'Lift homing',
  'door-release': 'Door release',
  'damper-close': 'Damper close',
  'gas-release': 'Gas release',
  'smoke-control': 'Smoke control',
  pressurisation: 'Pressurisation',
  'plant-shutdown': 'Plant shutdown',
  'relay-output': 'Relay output',
  other: 'Other',
};

const CELL_MARK: Record<string, string> = {
  operates: 'X',
  conditional: 'C',
  'not-linked': '',
};

/**
 * Builds the classic C&E grid: one row per cause, one column per distinct
 * effect, X where the cause operates the effect.
 *
 * Effect columns are derived from the rules themselves rather than a fixed
 * list, so a site with only three effects gets a three-column matrix instead of
 * fifteen mostly-empty ones.
 */
export function causeEffectMatrixSheet(panel: Panel, rules: CauseEffectRule[]): Sheet {
  const columns: { key: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const r of rules) {
    for (const e of r.effects) {
      const key = `${e.effectKind}|${e.effectLabel}`;
      if (!seen.has(key)) {
        seen.add(key);
        columns.push({ key, label: e.effectLabel || EFFECT_LABEL[e.effectKind] });
      }
    }
  }

  const header: Row = [H('Cause'), H('Type'), H('Zone'), ...columns.map((c) => H(c.label))];
  const rows: Row[] = [header];

  for (const r of rules) {
    const byKey = new Map(r.effects.map((e) => [`${e.effectKind}|${e.effectLabel}`, e]));
    const cells: Row = [r.causeLabel, r.causeKind, r.causeZoneNumber ?? ''];
    for (const c of columns) {
      const e = byKey.get(c.key);
      if (!e || e.state === 'not-linked') {
        cells.push('');
      } else {
        // A delay is part of the effect, so it belongs in the cell.
        const mark = CELL_MARK[e.state] ?? 'X';
        cells.push({
          v: e.delaySeconds ? `${mark} ${e.delaySeconds}s` : mark,
          style: e.state === 'conditional' ? 'warn' : 'pass',
        });
      }
    }
    rows.push(cells);
  }

  rows.push([], [{ v: 'X = operates    C = conditional (see notes)    ns = delay in seconds', style: 'muted' }]);

  return {
    name: `${panel.name} C&E`,
    rows,
    colWidths: [40, 18, 8, ...columns.map(() => 16)],
    freezeRows: 1,
  };
}
