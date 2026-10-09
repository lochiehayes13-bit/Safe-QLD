import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { LETTERHEAD_PAGE } from '@/export/letterhead';
import { LETTERHEAD_HEADER_DATA_URI } from '@/export/letterheadArt';
import { company } from '@/theme/brand';

import { buildLabelSheet, LABEL_STOCKS } from '@/export/assetLabels';
import { combinedFlowCertificateHtml, type CombinedFlowInput } from '@/export/combinedFlowCertificate';
import { criticalDefectNoticeHtml, type NoticeInput } from '@/export/criticalDefectNotice';
import { effectivenessReportHtml, type EffectivenessReportInput } from '@/export/effectivenessReport';
import { DEPARTMENT_NOTE, form72Html } from '@/export/form72';
import { impairmentNoticeHtml } from '@/export/impairmentNotice';
import { occupierStatementHtml, type OccupierStatementInput } from '@/export/occupierStatement';
import { timesheetDocumentHtml } from '@/export/timesheetDocument';
import { causeEffectHtml, serviceReportHtml } from '@/export/pdf';
import { quoteDocumentHtml } from '@/export/quoteDocument';
import { routineServiceReportHtml } from '@/export/routineServiceReport';
import { swmsHtml } from '@/export/swms';
import { printableDocument } from '@/export/webFiles';
import { zoneChartHtml } from '@/export/zoneChart';

import { formatTag } from '@/domain/assetTag';
import { emptyForm72 } from '@/domain/form72';
import { OCCUPIER_STATEMENT_INSTALLATIONS, type OccupierStatementRow } from '@/domain/qldCompliance';
import { DEFAULT_EXCLUSIONS, DEFAULT_VALIDITY_DAYS, type Quote, type QuoteLine } from '@/domain/quote';
import { SWMS_TEMPLATES } from '@/seed/swms';
import type { OccupierStatement } from '@/db/occupierRepo';
import type { ImpairmentRecord } from '@/db/opsRepo';
import type { ReportBundle } from '@/export/sheets';
import type { SwmsRecord } from '@/domain/swms';
import type { ZoneChart, ZoneChartRow } from '@/domain/zoneChart';
import type { CauseEffectRule, Defect, Panel, ServiceReport, Site, TestRow } from '@/domain/types';

/**
 * The roll-call: every document this app prints, and what mark it carries.
 *
 * This file exists because of how the letterhead came to be missing from nine
 * documents out of eleven. Nothing failed. `letterhead.test.ts` asserted that
 * the routine service report wore the masthead, and that was the whole of the
 * coverage — it did not even check the SWMS, the other document that already
 * had it. So every export written after the letterhead landed was written
 * without it, each one passed its own tests, and the gap was only found by
 * somebody counting the files in `src/export` that call `letterheaded`.
 *
 * Counting files by hand is not a test, so here is the count, written down. The
 * table below is deliberately a literal list rather than something derived by
 * walking the directory and calling whatever it finds. A derived table silently
 * absorbs a new document: the file appears, the loop picks it up, and if the
 * author happened to call `letterheaded` the suite stays green and nobody ever
 * decided anything. The point is the opposite — a new HTML-producing file in
 * `src/export` must make somebody stop and write down which mark it carries and
 * why. The roll-call guard at the bottom of this file is what forces that: it
 * reads the directory and fails on any document that is not named here.
 *
 * Three documents deliberately do not wear the full letterhead, and the reason
 * is recorded against each row rather than left to be rediscovered. The risk
 * with a deliberate exception is that the next reader sees the gap, calls it an
 * oversight and closes it: that would stack a second masthead over a statutory
 * form, push the tail of a zone chart onto a sheet the technician does not have
 * at the panel, and print 36mm of artwork across the top two rows of a sheet of
 * sticky labels. `letterheadExceptions.test.ts` holds the detail of all three;
 * the rows here hold the decision itself, so "deliberately excluded" and
 * "nobody has got to it yet" can never be confused with one another.
 */

const AT = '2026-07-03T06:00:00.000Z';

// ---------------------------------------------------------------------------
// Fixtures
//
// Invented throughout, and deliberately thin: this file is asking whether the
// company's mark is on the page, not whether the page says the right thing.
// Each document has its own test file for that. What every fixture does need is
// to be realistic enough that the builder takes its normal path rather than an
// empty-input shortcut, because a document that renders nothing renders no
// letterhead either and would pass a sloppier version of these assertions.
// ---------------------------------------------------------------------------

const site: Site = {
  id: 's1', name: 'An Example Building', address: '12 Example Street', suburb: 'Ipswich',
  state: 'QLD', postcode: '4305', clientName: 'Example Body Corporate',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

const panel: Panel = {
  id: 'p1', siteId: 's1', name: 'FIP 1', brand: 'kentec', model: 'Taktis',
  source: 'config-import', createdAt: AT, updatedAt: AT,
};

const defect: Defect = {
  id: 'd1', siteId: 's1', location: 'Level 3 east riser',
  description: 'Sprinkler control valve found closed and strapped.',
  severity: 'critical', status: 'open', raisedAt: AT, photos: [],
};

const reportRow: ServiceReport = {
  id: 'r1', siteId: 's1', title: 'Annual service', frequency: 'annual',
  serviceDate: '2026-07-03', technicianName: 'A Technician', technicianLicence: 'QLD-12345',
  status: 'draft', createdAt: AT, updatedAt: AT,
};

const testRow: TestRow = {
  id: 't1', reportId: 'r1', deviceText: 'PLANT ROOM', deviceType: 'smoke-photo',
  result: 'pass', sortIndex: 1,
};

const bundle: ReportBundle = {
  site, report: reportRow, panel, testRows: [testRow], checkRows: [], defects: [defect],
};

const causeEffectRules: CauseEffectRule[] = [{
  id: 'ce1', panelId: 'p1', causeLabel: 'Zone 1 Alarm', causeKind: 'zone-alarm',
  causeZoneNumber: 1,
  effects: [{
    id: 'e1', effectLabel: 'Evacuation alarm', effectKind: 'evacuation', state: 'operates',
  }],
}];

const impairment: ImpairmentRecord = {
  id: 'i1', siteId: 's1', system: 'Sprinkler system',
  scope: 'East riser isolated at the floor control valve',
  reason: 'Head replacement on level 3',
  startedAt: '2026-07-03T04:30:00.000Z',
  responsibleNotified: true, responsibleName: 'The building manager',
  brigadeNotified: false, monitoringNotified: false,
  fireWatchInPlace: true, signagePlaced: true, isolatedAssets: [],
};

const noticeInput: NoticeInput = {
  site, defect, technicianName: 'A Technician', technicianLicence: 'QBCC 123456',
  companyName: 'Safe QLD Pty Ltd', occupierName: 'Example Body Corporate',
  maintenanceAt: '2026-07-03T04:30:00.000Z', generatedAt: AT,
};

const statementRow = (installation: string): OccupierStatementRow => ({
  installation, present: false, criticalDefectNoticeGiven: false,
});

const occupierInput: OccupierStatementInput = {
  statement: {
    id: 'os1', siteId: 's1', occupierName: 'Example Body Corporate',
    occupierPhone: '07 3000 0000', premisesName: 'An Example Building',
    premisesAddress: '12 Example Street, Ipswich QLD 4305',
    periodStart: '2025-07-01', periodEnd: '2026-06-30',
    rows: OCCUPIER_STATEMENT_INSTALLATIONS.map(statementRow),
    signedBy: 'A Secretary', signedPosition: 'Body Corporate Secretary',
    createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
  } as OccupierStatement,
  companyName: 'Safe QLD Pty Ltd', preparedBy: 'A Technician', generatedAt: AT,
};

const flowInput: CombinedFlowInput = {
  buildingName: 'An Example Building', testDate: '2026-07-03',
  hydrantFlowLps: 10, hydrantPressureKpa: 700,
  equipment: [], testPoints: [], testedBy: 'A Technician',
};

/*
 * An unpriced line, on purpose.
 *
 * A quotation with no lines at all takes a short path through the builder and
 * says almost nothing, and this file is meant to exercise the real document. An
 * unpriced line is the shape that needs no price source attached to it, which
 * keeps the fixture honest without inventing rates.
 */
const quoteLine: QuoteLine = {
  id: 'm1', section: 'materials', description: 'Replacement sounder',
  unit: 'ea', quantity: 2, fromCodes: [], defectCount: 1,
};

const quote: Quote = {
  id: 'q1', siteId: 's1', reference: 'Q-EX-2026-004',
  clientName: 'Example Body Corporate', siteName: 'An Example Building',
  preparedBy: 'A Technician', status: 'draft', validityDays: DEFAULT_VALIDITY_DAYS,
  discountCents: 0, lines: [quoteLine], unpriceable: [],
  exclusions: [...DEFAULT_EXCLUSIONS], taxRate: 0.1,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
};

const effectivenessInput: EffectivenessReportInput = {
  reportReference: 'SQLD-EX-01', jobReference: '38412',
  assessmentType: 'Fire System Effectiveness / Readiness',
  clientName: 'Example Body Corporate', siteName: 'An Example Building',
  scopeLabel: 'Administration Building',
  attendanceDate: '2026-07-03', issueDate: '2026-07-06',
  assessedBy: 'Safe QLD Fire Protection', preparedBy: 'A Service Manager',
  findings: [],
};

const swmsTemplate = SWMS_TEMPLATES[0]!;

const swmsRecord: SwmsRecord = {
  id: 'sw1', templateIds: [swmsTemplate.id], title: 'Coring the slab at an example building',
  siteId: 's1', siteName: 'An Example Building', jobExternalId: '38412',
  jobTitle: 'Detection annual', date: '2026-07-03',
  supervisor: 'A Supervisor', supervisorPhone: '0400 000 000',
  answers: {}, addedHazards: [], ticked: [], notApplicable: [], crewRisk: {},
  ppeChecked: [], permits: [],
  workers: [{ name: 'A Technician', signature: 'data:sig', signedAt: AT }],
  status: 'signed', notes: 'Core drilling the slab to run pipe',
  createdAt: AT, updatedAt: AT,
};

const zoneRow = (n: number): ZoneChartRow => ({
  number: n, text: `Zone ${n} example area`, deviceCount: 3, summary: '3 detectors', unused: false,
});

const zoneChart: ZoneChart = {
  rows: Array.from({ length: 20 }, (_, i) => zoneRow(i + 1)),
  totalZones: 20, totalDevices: 60, untexted: [], orphanedPoints: 0,
};

const labelStock = LABEL_STOCKS[0]!;

/*
 * A real tag rather than a made-up string: `buildLabelSheet` omits a label it
 * cannot read a tag off, and an omitted label prints no cell, which would make
 * "this sheet carries no letterhead" true for the wrong reason.
 */
const labelTag = formatTag('extinguisher', 1201)!;

const labelSheet = () => buildLabelSheet(
  [{ tag: labelTag, typeLabel: 'Fire extinguisher', location: 'Level 1 · Plant room', siteName: 'An Example Building' }],
  { stock: labelStock },
);

// ---------------------------------------------------------------------------
// The roll-call itself
// ---------------------------------------------------------------------------

/**
 * What mark a document is supposed to carry.
 *
 * `full` is the ordinary case and what a new document should almost certainly
 * be. The other three are each a decision somebody made and had to justify, and
 * the justification is written against the row.
 */
type Furniture = 'full' | 'foot-only' | 'masthead-only' | 'none';

interface DocumentRow {
  /** What a failure prints, so the report names the document and not a number. */
  name: string;
  /** The file in `src/export` it lives in. The roll-call guard matches on this. */
  file: string;
  html: () => string;
  furniture: Furniture;
  /**
   * The `@page` declaration that must be in force, which is the last one in the
   * stylesheet — later declaration wins at equal specificity, the same as
   * anywhere else in CSS.
   */
  page: string;
  /**
   * How many `@page` rules the finished document should contain.
   *
   * Two means the document declares its own and `letterheaded` has emitted the
   * default ahead of it. One means either the document took the default or it
   * passed its page box in through the `page` option, which replaces the default
   * rather than competing with it.
   */
  pageRules: 1 | 2;
}

const DOCUMENTS: DocumentRow[] = [
  {
    name: 'routine service report',
    file: 'routineServiceReport.ts',
    html: () => routineServiceReportHtml({
      customer: { name: 'Example Body Corporate', contact: 'Pat Jones' },
      site: { name: 'An Example Building', contact: 'Pat Jones' },
      sections: [],
    }),
    furniture: 'full',
    // 12mm/10mm/16mm has been in that file since the report was written and did
    // not reach the printer for months, because the letterhead's own page box
    // was appended after it. That is the regression this column watches.
    page: 'size: A4; margin: 12mm 10mm 16mm;',
    pageRules: 2,
  },
  {
    name: 'safe work method statement',
    file: 'swms.ts',
    html: () => swmsHtml({ record: swmsRecord, templates: [swmsTemplate], generatedAt: AT }),
    furniture: 'full',
    page: LETTERHEAD_PAGE,
    pageRules: 1,
  },
  {
    name: 'service report (PDF)',
    file: 'pdf.ts',
    html: () => serviceReportHtml(bundle, AT),
    furniture: 'full',
    page: LETTERHEAD_PAGE,
    pageRules: 1,
  },
  {
    name: 'cause & effect matrix',
    file: 'pdf.ts',
    html: () => causeEffectHtml(panel, causeEffectRules, site.name, AT),
    furniture: 'full',
    // Landscape, and it comes in through the `page` option rather than as a rule
    // in the matrix's own stylesheet. A twenty-effect matrix forced back to
    // portrait loses its right-hand columns off the edge of the sheet.
    page: 'size: A4 landscape; margin: 10mm;',
    pageRules: 1,
  },
  {
    name: 'critical defect notice',
    file: 'criticalDefectNotice.ts',
    html: () => criticalDefectNoticeHtml(noticeInput),
    furniture: 'full',
    page: LETTERHEAD_PAGE,
    pageRules: 1,
  },
  {
    name: 'impairment notice',
    file: 'impairmentNotice.ts',
    html: () => impairmentNoticeHtml({
      record: impairment, site, companyName: 'Safe QLD Pty Ltd', generatedAt: AT,
    }),
    furniture: 'full',
    page: LETTERHEAD_PAGE,
    pageRules: 1,
  },
  {
    name: 'annual occupier statement',
    file: 'occupierStatement.ts',
    html: () => occupierStatementHtml(occupierInput),
    furniture: 'full',
    page: LETTERHEAD_PAGE,
    pageRules: 1,
  },
  {
    name: 'timesheet reading copy',
    file: 'timesheetDocument.ts',
    html: () => timesheetDocumentHtml({
      id: 't1',
      employeeName: 'L. Hayes',
      vehicleRego: 'ABC123',
      kilometerReading: '120450',
      weekStarting: '2026-08-10',
      entries: [{
        id: 'a', date: '2026-08-10', jobNumber: '43747', siteName: 'Kingaroy Fire Station',
        serviceReportNumber: '', startTime: '06:30', finishTime: '14:30', hourKind: 'ord',
        sick: '', rdo: '', annual: '', lwop: '', publicHoliday: '', comments: '',
      }],
      managerName: '',
      checkedBy: '',
      status: 'draft',
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    }),
    furniture: 'full',
    page: LETTERHEAD_PAGE,
    pageRules: 1,
  },
  {
    name: 'combined flow test certificate',
    file: 'combinedFlowCertificate.ts',
    html: () => combinedFlowCertificateHtml(flowInput),
    furniture: 'full',
    page: LETTERHEAD_PAGE,
    pageRules: 1,
  },
  {
    name: 'quotation',
    file: 'quoteDocument.ts',
    html: () => quoteDocumentHtml({ quote }),
    furniture: 'full',
    page: LETTERHEAD_PAGE,
    pageRules: 1,
  },
  {
    name: 'fire system effectiveness report',
    file: 'effectivenessReport.ts',
    html: () => effectivenessReportHtml(effectivenessInput),
    furniture: 'full',
    page: LETTERHEAD_PAGE,
    pageRules: 1,
  },
  {
    name: 'Form 72',
    file: 'form72.ts',
    html: () => form72Html({
      form: emptyForm72({
        id: 'f1', siteId: 's1', siteName: 'An Example Building',
        contractor: 'Safe QLD Pty Ltd', now: AT,
      }),
      companyName: 'Safe QLD Fire Protection',
      generatedAt: AT,
    }),
    /*
     * Foot only, and this is the one exception a reader is most likely to try to
     * "fix". Form 72 is the department's approved form and it opens with the
     * department's own full-width statutory head. The Safe QLD band stacked
     * above that gives the reader two mastheads, reads as though the company has
     * altered a form the regulator prescribes, and pushes the signature part of
     * Part I onto a second page. The foot stays because the entity line
     * carries the legal name and the ABN, and a statutory record
     * leaving this company without its ABN on it is a different problem again.
     */
    furniture: 'foot-only',
    page: 'size: A4; margin: 12mm 10mm;',
    pageRules: 2,
  },
  {
    name: 'zone chart (letterheaded copy)',
    file: 'zoneChart.ts',
    html: () => zoneChartHtml({
      site, panel, chart: zoneChart, companyName: 'Safe QLD Fire Protection',
      generatedAt: AT, letterhead: true,
    }),
    /*
     * Masthead only, and only when asked for — the copy that goes on the panel
     * door prints bare. The chart's whole job is to fit on one sheet: the
     * masthead is 36mm across a 190mm column and the entity line another 15mm,
     * which is enough to put the bottom of a forty-row chart on a page nobody is
     * holding at the panel. The `.foot` line already carries the company name
     * and "Verify against the panel before it is relied on", and that warning is
     * the one that matters to somebody reading this at a panel at night; burying
     * it above an ABN line would not improve it.
     */
    furniture: 'masthead-only',
    page: 'size: A4 portrait; margin: 10mm;',
    pageRules: 1,
  },
  {
    name: 'asset label sheet',
    file: 'assetLabels.ts',
    html: () => labelSheet().html,
    /*
     * No letterhead at all. These are equipment stickers, not a document: the
     * page margin is zero because the printer must not inset anything, and every
     * cell sits at an absolute millimetre offset taken off the die-cut stock.
     * Artwork at the top would print across the first two rows of labels, and
     * shifting the grid down to make room misses the die cut and wastes the
     * sheet. There is no flow on this page for a masthead to sit in.
     */
    furniture: 'none',
    page: `size: ${labelStock.pageWidthMm}mm ${labelStock.pageHeightMm}mm; margin: 0;`,
    pageRules: 1,
  },
];

/**
 * Files in `src/export` that emit HTML and are deliberately not documents.
 *
 * Named, rather than skipped by a pattern, for the same reason the table above
 * is a literal: a file that produces markup and is not on either list should
 * stop the build.
 */
const HTML_BUT_NOT_A_DOCUMENT: { file: string; reason: string }[] = [
  {
    file: 'letterhead.ts',
    reason: 'the helper that applies the letterhead — it is the thing under test, not a document',
  },
  {
    file: 'webFiles.ts',
    reason: 'a web delivery wrapper. `printableDocument` puts a <title> on markup another builder '
      + 'already produced, so the browser offers a sensible file name at "Save as PDF". It adds no '
      + 'letterhead because the document it wraps already has one, and giving it one of its own '
      + 'would print the masthead twice on the web build and nowhere else.',
  },
];

/**
 * Files in `src/export` that produce no HTML at all, listed so that the absence
 * is on the record.
 *
 * `safeqldForms.ts` was named as a letterhead gap in the brief that started this
 * work and is not one: it builds XLSX `Sheet` objects, cell by cell, and emits
 * no markup anywhere. A workbook has no page box and no masthead to place. The
 * guard below checks that this stays true, so if somebody ever adds an HTML
 * preview to it the claim fails rather than quietly going stale.
 */
const NO_MARKUP_AT_ALL: { file: string; reason: string }[] = [
  { file: 'safeqldForms.ts', reason: 'XLSX Sheet objects, no HTML' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The document's one stylesheet, which is where the whole cascade happens.
 *
 * Every assertion about `@page` reads from here rather than from the whole
 * document, because a class name like `lh-entity` appears in the stylesheet as
 * well as in the markup and a whole-document `indexOf` finds the rule.
 */
function styles(html: string): string {
  const open = html.indexOf('<style>');
  return open < 0 ? '' : html.slice(open + '<style>'.length, html.indexOf('</style>'));
}

/** What is inside `<body>`, so furniture is measured as markup and not as CSS. */
function bodyOf(html: string): string {
  return html.slice(html.indexOf('<body>'));
}

/** Every `@page` declaration in the stylesheet, in cascade order. */
function pageRules(html: string): string[] {
  const out: string[] = [];
  const re = /@page\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null = re.exec(styles(html));
  while (m) {
    out.push((m[1] ?? '').trim().replace(/\s+/g, ' '));
    m = re.exec(styles(html));
  }
  return out;
}

function decode(dataUri: string): Buffer {
  return Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64');
}

/**
 * The pixel size a JPEG declares, read off its start-of-frame marker.
 *
 * Walked marker by marker rather than looked for at a fixed offset, because the
 * segments ahead of the frame header vary with whatever exported the file — a
 * regenerated logo with an extra colour profile in it moves everything along.
 */
function jpegSize(bytes: Buffer): { width: number; height: number } | undefined {
  let p = 2;
  while (p < bytes.length - 8) {
    if (bytes[p] !== 0xFF) { p += 1; continue; }
    const marker = bytes[p + 1]!;
    // Start-of-frame: C0 through CF, less the three in that range that are not
    // frame headers (DHT, JPG, DAC).
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { height: bytes.readUInt16BE(p + 5), width: bytes.readUInt16BE(p + 7) };
    }
    // Standalone markers carry no length word, so stepping over a length here
    // would read the image data as a segment size and run off the end.
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { p += 2; continue; }
    p += 2 + bytes.readUInt16BE(p + 2);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// One document at a time
// ---------------------------------------------------------------------------

describe.each(DOCUMENTS)('$name', (row: DocumentRow) => {
  const html = row.html();
  const body = bodyOf(html);

  it('is one well-formed document', () => {
    /*
     * A stray second `<body>` from a half-finished refactor renders in some
     * engines and not in others, which is the worst possible way to find out —
     * the technician's phone shows it correctly and the building manager's
     * browser shows nonsense.
     */
    expect({
      doctype: html.startsWith('<!DOCTYPE html>'),
      bodies: (html.match(/<body>/g) ?? []).length,
      closes: (html.match(/<\/html>/g) ?? []).length,
    }).toEqual({ doctype: true, bodies: 1, closes: 1 });
  });

  it(`carries the ${row.furniture} letterhead and nothing more`, () => {
    /*
     * The one assertion the whole file is for. Measured inside `<body>`, and
     * asserted as a whole object rather than three separate expects so a failure
     * prints what the document does carry beside what it should — which is the
     * difference between "the masthead is missing" and "somebody gave the label
     * sheet a masthead".
     */
    const expected = {
      masthead: row.furniture === 'full' || row.furniture === 'masthead-only',
      // The foot is the entity line and nothing else: the orange swoosh that
      // closed every page went at the owner's ask.
      footArtwork: false,
      entity: row.furniture === 'full' || row.furniture === 'foot-only',
    };
    expect({
      masthead: body.includes('lh-header'),
      footArtwork: body.includes('lh-footer'),
      entity: body.includes('lh-entity'),
    }).toEqual(expected);
  });

  it('prints the entity details as text where it carries the foot', () => {
    /*
     * The ABN is the part of the letterhead that has to be right, and it is not
     * in the artwork — the artwork cannot be corrected without new files from
     * the office. Real text also means the document is searchable by ABN in the
     * office's own filing, which is how a printed copy gets matched back to a
     * job months later.
     */
    const footed = row.furniture === 'full' || row.furniture === 'foot-only';
    expect({
      abn: html.includes(company.abn),
      legalName: html.includes(company.legalName),
      phone: html.includes(company.phone),
    }).toEqual({ abn: footed, legalName: footed, phone: footed });
  });

  it('prints on the page box it intended', () => {
    /*
     * The assertion that would have caught the zone chart. A letterhead that
     * forced `size: A4` on every document turns a landscape chart back to
     * portrait and takes the right-hand column off the paper, and nothing about
     * the generated HTML looks wrong — you find out when the chart is on the
     * panel door.
     *
     * Read as the last rule in the stylesheet, because that is what the printer
     * obeys. Anything earlier is overridden.
     */
    const rules = pageRules(html);
    expect({ count: rules.length, inForce: rules[rules.length - 1] })
      .toEqual({ count: row.pageRules, inForce: row.page });
  });
});

// ---------------------------------------------------------------------------
// The regression that was invisible for months
// ---------------------------------------------------------------------------

describe("a document's own @page survives the letterhead", () => {
  /*
   * `letterheaded` used to append its whole stylesheet, page box included, after
   * the caller's. For `@page` the later declaration wins the same way it does
   * anywhere else, so every document that set its own page margins lost —
   * silently, with the rule sitting right there in the file looking like it
   * worked. The routine service report asked for a 16mm bottom margin from the
   * day it was written and printed on 10mm for months: enough to move the
   * signature block down the sheet and not enough for anybody to chase.
   *
   * So the page box is emitted first now, and this is the test that keeps it
   * there.
   */
  const declareTheirOwn = DOCUMENTS.filter((d) => d.pageRules === 2);

  it('has documents that declare their own page box at all', () => {
    // Without this, the filter going empty — a document quietly losing its own
    // @page, or the column being edited to 1 to make a failure go away — turns
    // every assertion below into a pass over nothing.
    expect(declareTheirOwn.map((d) => d.name)).toEqual(['routine service report', 'Form 72']);
  });

  it.each(declareTheirOwn)('$name keeps its own margins, with the letterhead default overridden', (row: DocumentRow) => {
    const rules = pageRules(row.html());
    expect({ first: rules[0], last: rules[1], count: rules.length })
      .toEqual({ first: LETTERHEAD_PAGE, last: row.page, count: 2 });
  });
});

// ---------------------------------------------------------------------------
// The exceptions, stated as negatives
// ---------------------------------------------------------------------------

describe('the asset label sheet stays bare', () => {
  /*
   * Stated here as well as in `letterheadExceptions.test.ts` because the two
   * files fail for different reasons and a reader needs both. That file explains
   * the die cut; this one is the roll-call, and a roll-call that only ever
   * asserts presence would be satisfied by somebody adding the masthead to the
   * one document that must not have it.
   */
  const sheet = labelSheet();

  it('printed the label it was given, so this is a real sheet', () => {
    expect({ printed: sheet.printed, omitted: sheet.omitted }).toEqual({ printed: 1, omitted: [] });
  });

  it('carries no letterhead markup and no letterhead rules', () => {
    for (const marker of ['lh-header', 'lh-footer', 'lh-entity']) {
      expect({ marker, present: sheet.html.includes(marker) }).toEqual({ marker, present: false });
    }
  });

  it('keeps the zero page margin the die cut depends on', () => {
    expect(pageRules(sheet.html))
      .toEqual([`size: ${labelStock.pageWidthMm}mm ${labelStock.pageHeightMm}mm; margin: 0;`]);
  });
});

describe("Form 72 wears the mark at the foot and nothing above the department's head", () => {
  const html = DOCUMENTS.find((d) => d.name === 'Form 72')!.html();
  const body = bodyOf(html);

  it('puts nothing above the statutory head band', () => {
    /*
     * The department's `.head` must be the first thing inside `<body>`. Two
     * mastheads stacked is a document whose author the reader cannot identify,
     * and on an approved form it reads as though the company has altered the
     * regulator's paperwork.
     */
    expect({
      masthead: body.includes('lh-header'),
      headBeforeAnyFurniture: body.indexOf('class="head"') < body.indexOf('lh-'),
    }).toEqual({ masthead: false, headBeforeAnyFurniture: true });
  });

  it("closes with the entity line, below the department's own note", () => {
    /*
     * The ordering is the judgement call, not an accident of assembly. The
     * entity line sits under the department's note and under our own "not part
     * of the department's form" block, so it reads as the producer's mark on a
     * reproduced form rather than as part of the form itself.
     */
    const at = {
      deptNote: body.indexOf(DEPARTMENT_NOTE.slice(0, 40)),
      entity: body.indexOf('lh-entity'),
      bodyEnd: body.indexOf('</body>'),
    };
    expect(at.deptNote).toBeGreaterThan(0);
    expect(at.entity).toBeGreaterThan(at.deptNote);
    expect(at.bodyEnd).toBeGreaterThan(at.entity);
    expect(body).not.toContain('lh-footer');
  });
});

describe('the zone chart that goes on the panel door', () => {
  it('prints bare unless the letterhead is asked for', () => {
    // The table row above covers the emailed copy. This is the default, and the
    // default is the one that gets printed on site.
    const html = zoneChartHtml({
      site, panel, chart: zoneChart, companyName: 'Safe QLD Fire Protection', generatedAt: AT,
    });
    expect({ masthead: html.includes('lh-header'), entity: html.includes('lh-entity') })
      .toEqual({ masthead: false, entity: false });
  });

  it('stays landscape with the letterhead on', () => {
    // A chart wide enough to need landscape is the case the @page split exists
    // for, and the row in the table above uses a portrait chart, so the sideways
    // one is asserted here rather than left to the other file alone.
    const wide: ZoneChart = {
      ...zoneChart,
      rows: Array.from({ length: 41 }, (_, i) => zoneRow(i + 1)),
      totalZones: 41,
      totalDevices: 123,
    };
    const html = zoneChartHtml({
      site, panel, chart: wide, companyName: 'Safe QLD Fire Protection',
      generatedAt: AT, letterhead: true,
    });
    expect(pageRules(html)).toEqual(['size: A4 landscape; margin: 10mm;']);
  });
});

// ---------------------------------------------------------------------------
// The wrapper, named so it is not mistaken for a gap
// ---------------------------------------------------------------------------

describe('printableDocument is a delivery wrapper, not a document', () => {
  /*
   * It exists because a browser offers a page's `<title>` as the file name at
   * "Save as PDF", so without one a report saves as "about:blank". It must not
   * add a letterhead of its own: the markup handed to it has already been
   * through `letterheaded`, and a second masthead would appear on the web build
   * and nowhere else, which is the hardest kind of difference to notice.
   */
  const inner = DOCUMENTS[0]!.html();

  it('leaves a letterheaded document exactly as it found it', () => {
    expect(printableDocument('Service report', inner)).toBe(inner);
  });

  it('adds no letterhead of its own to markup that has none', () => {
    const wrapped = printableDocument('A fragment', '<p>Just a fragment</p>');
    expect({
      titled: wrapped.includes('<title>A fragment</title>'),
      masthead: wrapped.includes('lh-header'),
      entity: wrapped.includes('lh-entity'),
    }).toEqual({ titled: true, masthead: false, entity: false });
  });
});

// ---------------------------------------------------------------------------
// The artwork itself
// ---------------------------------------------------------------------------

describe('the embedded artwork keeps its shape', () => {
  /*
   * `letterhead.test.ts` already checks that both files decode to a real JPEG
   * inside a plausible byte band, which catches a copy that lost its tail. It
   * cannot catch a regenerated logo: a re-export at half resolution, or one
   * cropped a few pixels tighter, decodes perfectly and sits inside the same
   * byte band, and the only symptom is a soft masthead on a printed page or a
   * band whose proportions no longer match the stock the office posts out.
   *
   * The CSS depends on these numbers. `.lh-header img` is `width: 100%` with
   * `height: auto`, so the printed height of the band is purely the artwork's
   * aspect ratio — 189/1000 across a 190mm column is the 36mm the whole layout
   * is reasoned from. Change the pixels and every page-break judgement in
   * `src/export` is working from the wrong figure.
   */
  it.each([
    ['header band', LETTERHEAD_HEADER_DATA_URI, 1000, 189],
  ])('the %s is still %sx%s pixels', (_name, uri, width, height) => {
    expect(jpegSize(decode(uri))).toEqual({ width, height });
  });
});

// ---------------------------------------------------------------------------
// The roll-call guard
// ---------------------------------------------------------------------------

describe('every HTML-producing file in src/export is accounted for', () => {
  /*
   * This is what makes the literal table above worth writing. The table itself
   * cannot notice a new document — it only tests what it names. So the directory
   * is read here and every file that produces markup has to appear on one of the
   * three lists, with a reason where it is not an ordinary document.
   *
   * The failure is the feature. Somebody adding a new export gets told, at the
   * point of adding it, that they have to decide what mark it carries. That
   * decision is the thing nine documents never got, and the reason this file
   * exists.
   */
  const EXPORT_DIR = join(__dirname, '..', 'export');

  /** A file that builds a page: its own skeleton, or through the helper. */
  const MARKERS = /<!DOCTYPE html>|letterheaded\(|letterheadHeaderHtml\(|letterheadFooterHtml\(/;

  function sourceFiles(): string[] {
    return readdirSync(EXPORT_DIR)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
      .sort();
  }

  function producesHtml(file: string): boolean {
    return MARKERS.test(readFileSync(join(EXPORT_DIR, file), 'utf8'));
  }

  it('found the export folder and read something from it', () => {
    // A guard that silently reads an empty directory passes forever.
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain('letterhead.ts');
  });

  it('names every file that builds a page', () => {
    const accounted = new Set([
      ...DOCUMENTS.map((d) => d.file),
      ...HTML_BUT_NOT_A_DOCUMENT.map((e) => e.file),
    ]);
    const unaccounted = sourceFiles().filter((f) => producesHtml(f) && !accounted.has(f));
    /*
     * If this fails on a file you have just added: add a row to DOCUMENTS with
     * the builder, the furniture it carries and the page box it intends, or — if
     * it is genuinely not a document somebody reads — add it to
     * HTML_BUT_NOT_A_DOCUMENT with the reason. Deleting the file from this
     * assertion is not one of the options.
     */
    expect(unaccounted).toEqual([]);
  });

  it('still finds every file the table claims', () => {
    // The other direction: a builder moved to a new file, or renamed, leaves a
    // row pointing at nothing and the roll-call quietly stops covering it.
    const present = new Set(sourceFiles());
    for (const file of [...DOCUMENTS.map((d) => d.file), ...HTML_BUT_NOT_A_DOCUMENT.map((e) => e.file)]) {
      expect({ file, present: present.has(file) }).toEqual({ file, present: true });
    }
  });

  it('holds the no-markup claims to being true', () => {
    // `safeqldForms.ts` is on this list because the brief that started the
    // letterhead work named it as a missing document and it is not one. If an
    // HTML preview is ever added to it, that stops being true and this fails
    // rather than the claim going stale in a comment.
    for (const { file, reason } of NO_MARKUP_AT_ALL) {
      expect({ file, reason, html: producesHtml(file) }).toEqual({ file, reason, html: false });
    }
  });
});
