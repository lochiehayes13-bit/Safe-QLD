/**
 * The department's published Form 72, as data.
 *
 * Every string below is transcribed from the Queensland Government's published
 * Form 72 (Version 1 – July 2014) and carries the page and line it came from,
 * so a reviewer can check the transcription against the source rather than
 * trusting whoever typed it. The companion suite renders a Form 72 and fails if
 * any of it is absent.
 *
 * It holds only what the department PREPRINTS: headings, labels, tick-box
 * option labels, column heads, the instructional notes, the unit annotations
 * and the footer. It holds no readings and no tick states — those are the
 * technician's, they differ on every form, and the suite proves the point by
 * asserting the whole inventory twice: once against a form with every box
 * filled and once against a form with none of them filled.
 *
 * NOT a test file. jest's testMatch takes only names ending in .test.ts under
 * __tests__, which this name does not, so it is imported and never run as a
 * suite of its own.
 */

export type OfficialSection =
  | 'header' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'footer';

export type OfficialKind =
  /** The document title across the top. */
  | 'title'
  /** The statutory preamble under the title. */
  | 'intro'
  /** A part heading, printed in the dark band. */
  | 'band'
  /** The instructional note printed under a band. */
  | 'note'
  /** A field label. */
  | 'label'
  /** A table column head. */
  | 'column'
  /** A row-group heading down the left of a table. */
  | 'group'
  /** A fixed row label inside a table. */
  | 'row'
  /** A tick-box option label. */
  | 'tick'
  /** A PASS or FAIL result-box label in a part's band. */
  | 'result'
  /** The closing notices, the copyright line, the version and the imprint. */
  | 'footer';

export interface OfficialEntry {
  /** Unique, so a failure names the entry instead of quoting 400 characters. */
  id: string;
  section: OfficialSection;
  kind: OfficialKind;
  /** The department's words, exactly as the published form prints them. */
  text: string;
  /** Page and line in official-form72.txt, for checking the transcription. */
  source: string;
  /**
   * How the page is allowed to satisfy it. 'text' (the default) matches the
   * tag-stripped text of the entry's section, which is what lets a label split
   * across elements still count. 'markup' matches the raw markup, for the few
   * entries where the element matters.
   */
  match?: 'text' | 'markup';
  /**
   * Set where the department's words and ours are not the same string. The
   * suite asserts `rendersAs` instead of `text` and fails if that is absent
   * too, so a deviation cannot rot into a silent omission. Every one needs a
   * reason, and the suite counts them, so a new one cannot be added quietly.
   */
  deviation?: { rendersAs: string; why: string };
}

/**
 * A preprinted unit annotation and the field it sits beside.
 *
 * Held apart from the labels because the page attaches the unit to the number
 * rather than printing it beside an empty box — deliberately, so that a box
 * nobody filled does not print "Not recorded kPa". That makes every unit
 * value-bound: it is asserted against the filled render only.
 */
export interface OfficialUnit {
  id: string;
  section: OfficialSection;
  /** The label the unit is printed next to on the paper. */
  field: string;
  unit: 'kPa' | 'mins' | 'L/min' | 'L/s' | 'm';
  source: string;
}

/** Which parts the department bands with PASS and FAIL, and which it does not. */
export const OFFICIAL_RESULT_BANDS: Readonly<Record<string, readonly string[]>> = {
  B: ['PASS', 'FAIL'],
  D: ['PASS', 'FAIL'],
  E: ['PASS', 'FAIL'],
  F: ['PASS', 'FAIL'],
};

/** Parts whose band carries no result box at all on the published form. */
export const OFFICIAL_UNBANDED_PARTS = ['A', 'C', 'G', 'H', 'I'] as const;

const FORM_TITLE_FULL = 'Form 72—fire hydrant and sprinkler system periodic testing and maintenance';

export const OFFICIAL_FORM_72: readonly OfficialEntry[] = [
  // --- the top of the page -------------------------------------------------
  { id: 'header.title', section: 'header', kind: 'title', source: 'p1 L4', text: FORM_TITLE_FULL },
  {
    id: 'header.intro', section: 'header', kind: 'intro', source: 'p1 L5-9',
    text: 'This form is to be used for the purposes of maintenance to water based fire safety '
      + 'installations, as required by the Queensland Development Code – Mandatory Part (MP) 6.1, '
      + 'which is a building assessment provision under the Building Act 1975, section 30. This '
      + 'form is also to be used in accordance with the ‘Fire hydrant and sprinkler system '
      + 'commissioning and periodic maintenance procedure’, defined in MP 6.1 as the '
      + '‘Relevant procedure’. Please note that this form does not comprise all '
      + 'maintenance requirements—this form is only for collecting results for maintenance for '
      + 'some sections of the Australian Standards referred to and in each case, further testing '
      + 'is required.',
  },

  // --- Part A --------------------------------------------------------------
  { id: 'A.band', section: 'A', kind: 'band', source: 'p1 L10', text: 'Part A—Test details' },
  { id: 'A.siteName', section: 'A', kind: 'label', source: 'p1 L11', text: 'Site name' },
  { id: 'A.siteAddress', section: 'A', kind: 'label', source: 'p1 L12', text: 'Site address' },
  { id: 'A.contractor', section: 'A', kind: 'label', source: 'p1 L13', text: 'Contractor' },
  { id: 'A.group', section: 'A', kind: 'group', source: 'p1 L14-15', text: 'Test details' },
  { id: 'A.testDate', section: 'A', kind: 'label', source: 'p1 L16', text: 'Test date:' },
  { id: 'A.maintenanceTest', section: 'A', kind: 'label', source: 'p1 L16', text: 'Maintenance test:' },
  { id: 'A.annual', section: 'A', kind: 'column', source: 'p1 L16', text: 'Annual' },
  { id: 'A.fiveYear', section: 'A', kind: 'column', source: 'p1 L16', text: '5 year' },
  { id: 'A.fireHydrant', section: 'A', kind: 'row', source: 'p1 L17', text: 'fire hydrant' },
  { id: 'A.fireSprinkler', section: 'A', kind: 'row', source: 'p1 L18', text: 'fire sprinkler' },
  { id: 'A.combined', section: 'A', kind: 'row', source: 'p1 L19', text: 'combined' },
  { id: 'A.time', section: 'A', kind: 'label', source: 'p1 L20', text: 'Time:' },

  // --- Part B --------------------------------------------------------------
  { id: 'B.band', section: 'B', kind: 'band', source: 'p1 L21', text: 'Part B—Hydrant hydrostatic test' },
  { id: 'B.pass', section: 'B', kind: 'result', source: 'p1 L21', text: 'PASS' },
  { id: 'B.fail', section: 'B', kind: 'result', source: 'p1 L21', text: 'FAIL' },
  {
    id: 'B.note', section: 'B', kind: 'note', source: 'p1 L22',
    text: 'Refer to the required pressure specification for periodic testing (as applicable) as '
      + 'per AS2419.1 or AS1851.',
  },
  { id: 'B.boostPressure', section: 'B', kind: 'label', source: 'p1 L23', text: 'Boost pressure' },
  { id: 'B.testPressure', section: 'B', kind: 'label', source: 'p1 L23', text: 'Test pressure' },
  { id: 'B.duration', section: 'B', kind: 'label', source: 'p1 L24', text: 'Duration of test' },
  { id: 'B.endPressure', section: 'B', kind: 'label', source: 'p1 L24', text: 'End of test pressure' },
  { id: 'B.loss', section: 'B', kind: 'label', source: 'p1 L24', text: 'Loss (if any):' },
  { id: 'B.comments', section: 'B', kind: 'label', source: 'p1 L25', text: 'Comments:' },

  // --- Part C --------------------------------------------------------------
  {
    id: 'C.band', section: 'C', kind: 'band', source: 'p1 L26',
    text: 'Part C—Hydrant test equipment/pressure gauges',
  },
  {
    id: 'C.note', section: 'C', kind: 'note', source: 'p1 L27',
    text: 'If using more devices, provide details in the Notes section below or complete another '
      + 'form. The correction factor must be kPa or a percentage.',
  },
  { id: 'C.flowDevice', section: 'C', kind: 'label', source: 'p1 L28', text: 'Flow measuring device' },
  { id: 'C.orifice', section: 'C', kind: 'tick', source: 'p1 L28', text: 'Orifice' },
  { id: 'C.mechanical', section: 'C', kind: 'tick', source: 'p1 L28', text: 'Mechanical' },
  { id: 'C.electromagnetic', section: 'C', kind: 'tick', source: 'p1 L28', text: 'Electro magnetic' },
  {
    id: 'C.orificeNote', section: 'C', kind: 'label', source: 'p1 L29',
    text: 'Part C not required for orifice testing',
  },
  {
    id: 'C.calibrated', section: 'C', kind: 'label', source: 'p1 L29',
    text: 'Calibrated:',
    deviation: {
      rendersAs: 'Mechanical calibrated:',
      why: 'The department prints the word twice, unqualified, on one line — once for the '
        + 'mechanical device and once for the electromagnetic. Two identical labels side by side '
        + 'are unanswerable on a phone, so the kind each one belongs to is printed in front of it. '
        + 'The pair is asserted by C.calibratedElectromagnetic as well, so neither can be dropped.',
    },
  },
  {
    id: 'C.calibratedElectromagnetic', section: 'C', kind: 'label', source: 'p1 L29',
    text: 'Calibrated:',
    deviation: {
      rendersAs: 'Electro magnetic calibrated:',
      why: 'The second of the department’s two Calibrated: fields on that line.',
    },
  },
  { id: 'C.slot1', section: 'C', kind: 'column', source: 'p1 L30', text: 'Device/gauge 1' },
  { id: 'C.slot2', section: 'C', kind: 'column', source: 'p1 L30', text: 'Device/gauge 2' },
  { id: 'C.slot3', section: 'C', kind: 'column', source: 'p1 L30', text: 'Device/gauge 3' },
  { id: 'C.slot4', section: 'C', kind: 'column', source: 'p1 L30', text: 'Device/gauge 4' },
  { id: 'C.serial', section: 'C', kind: 'label', source: 'p1 L31', text: 'Serial number' },
  { id: 'C.dateCalibrated', section: 'C', kind: 'label', source: 'p1 L32', text: 'Date calibrated' },
  { id: 'C.certificate', section: 'C', kind: 'label', source: 'p1 L33', text: 'Correction certificate' },
  { id: 'C.face', section: 'C', kind: 'label', source: 'p1 L34', text: '65/100/150 mm face' },
  { id: 'C.digital', section: 'C', kind: 'label', source: 'p1 L35', text: 'Digital reader' },
  { id: 'C.increments', section: 'C', kind: 'label', source: 'p1 L36', text: 'Increments (kPa)' },

  // --- Part D --------------------------------------------------------------
  { id: 'D.band', section: 'D', kind: 'band', source: 'p1 L37', text: 'Part D—Hydrant system flow test' },
  { id: 'D.pass', section: 'D', kind: 'result', source: 'p1 L37', text: 'PASS' },
  { id: 'D.fail', section: 'D', kind: 'result', source: 'p1 L37', text: 'FAIL' },
  {
    id: 'D.note', section: 'D', kind: 'note', source: 'p1 L38-40',
    text: 'This part relates to tests under Section 4 of AS1851. If pressure/flow rates do not '
      + 'meet the fire system design criteria and there are no on-site problems, contact the '
      + 'relevant water service provider to ascertain if there are any problems with the water '
      + 'system network. In the table below, please record the pressure readings obtained during '
      + 'the hydrant system flow test.',
  },
  { id: 'D.loc1', section: 'D', kind: 'label', source: 'p1 L41', text: 'Hydrant 1 location' },
  { id: 'D.loc3', section: 'D', kind: 'label', source: 'p1 L41', text: 'Hydrant 3 location' },
  { id: 'D.loc2', section: 'D', kind: 'label', source: 'p1 L42', text: 'Hydrant 2 location' },
  { id: 'D.loc4', section: 'D', kind: 'label', source: 'p1 L42', text: 'Hydrant 4 location' },
  { id: 'D.requirements', section: 'D', kind: 'label', source: 'p1 L43', text: 'System requirements' },
  { id: 'D.static', section: 'D', kind: 'label', source: 'p1 L43', text: 'Static pressure' },
  { id: 'D.pumpSet', section: 'D', kind: 'label', source: 'p1 L44', text: 'On-site pump set installed' },
  { id: 'D.pumpSetYes', section: 'D', kind: 'tick', source: 'p1 L44', text: 'Yes' },
  { id: 'D.pumpSetNo', section: 'D', kind: 'tick', source: 'p1 L44', text: 'No' },
  { id: 'D.zone', section: 'D', kind: 'label', source: 'p1 L45-46', text: 'Pressure zone number:' },
  { id: 'D.colSize', section: 'D', kind: 'column', source: 'p1 L47-48', text: 'Size/flow rate' },
  { id: 'D.colDevice', section: 'D', kind: 'column', source: 'p1 L49-50', text: 'Device/gauge no. (Part C)' },
  { id: 'D.col1', section: 'D', kind: 'column', source: 'p1 L51-52', text: 'Hydrant 1 only' },
  { id: 'D.col12', section: 'D', kind: 'column', source: 'p1 L53-54', text: 'Hydrants 1 and 2' },
  { id: 'D.col123', section: 'D', kind: 'column', source: 'p1 L55-56', text: 'Hydrants 1, 2 and 3' },
  { id: 'D.col1234', section: 'D', kind: 'column', source: 'p1 L57-58', text: 'Hydrants 1, 2, 3 and 4' },
  { id: 'D.groupNozzles', section: 'D', kind: 'group', source: 'p1 L59', text: 'Nozzles' },
  { id: 'D.row19', section: 'D', kind: 'row', source: 'p1 L59', text: '19 mm' },
  { id: 'D.row22', section: 'D', kind: 'row', source: 'p1 L60', text: '22 mm' },
  { id: 'D.row25', section: 'D', kind: 'row', source: 'p1 L61', text: '25 mm' },
  {
    id: 'D.groupDevices', section: 'D', kind: 'group', source: 'p1 L62-63',
    text: 'Other portable testing devices',
  },
  { id: 'D.row5', section: 'D', kind: 'row', source: 'p1 L64', text: '5 L/s' },
  { id: 'D.row10', section: 'D', kind: 'row', source: 'p1 L65', text: '10 L/s' },
  { id: 'D.row15', section: 'D', kind: 'row', source: 'p1 L66', text: '15 L/s' },
  { id: 'D.row20', section: 'D', kind: 'row', source: 'p1 L67', text: '20 L/s' },
  { id: 'D.row30', section: 'D', kind: 'row', source: 'p1 L68', text: '30 L/s' },
  { id: 'D.achieved', section: 'D', kind: 'label', source: 'p1 L69', text: 'System achieved:' },

  // --- Part E --------------------------------------------------------------
  { id: 'E.band', section: 'E', kind: 'band', source: 'p2 L75', text: 'Part E—Pump appliance booster test' },
  { id: 'E.pass', section: 'E', kind: 'result', source: 'p2 L75', text: 'PASS' },
  { id: 'E.fail', section: 'E', kind: 'result', source: 'p2 L75', text: 'FAIL' },
  {
    id: 'E.note', section: 'E', kind: 'note', source: 'p2 L76-78',
    text: 'This part relates to sections 10.4 and 10.5 of AS2419.1 and for tests under Section 4 '
      + 'of AS1851. If pressure/flow rates do not meet the fire system design criteria and there '
      + 'are no on-site problems, contact the relevant water service provider to ascertain if '
      + 'there are any problems with the water system network. In the table below, please record '
      + 'the pressure readings obtained during the pump appliance booster test.',
  },
  { id: 'E.locations', section: 'E', kind: 'label', source: 'p2 L79', text: 'Hydrant locations' },
  {
    id: 'E.height', section: 'E', kind: 'label', source: 'p2 L79',
    text: 'Height of highest hydrant above booster',
  },
  { id: 'E.requirements', section: 'E', kind: 'label', source: 'p2 L80', text: 'System requirements' },
  { id: 'E.static', section: 'E', kind: 'label', source: 'p2 L80', text: 'Static pressure' },
  { id: 'E.inlet', section: 'E', kind: 'label', source: 'p2 L81', text: 'Pump inlet pressure' },
  { id: 'E.discharge', section: 'E', kind: 'label', source: 'p2 L81', text: 'Pump discharge pressure' },
  { id: 'E.boost', section: 'E', kind: 'label', source: 'p2 L82', text: 'Boost pressure' },
  { id: 'E.friction', section: 'E', kind: 'label', source: 'p2 L82', text: 'Calculated frictional loss' },
  { id: 'E.comments', section: 'E', kind: 'label', source: 'p2 L83', text: 'Comments:' },

  // --- Part F --------------------------------------------------------------
  { id: 'F.band', section: 'F', kind: 'band', source: 'p2 L84', text: 'Part F—Sprinkler hydrostatic test' },
  { id: 'F.pass', section: 'F', kind: 'result', source: 'p2 L84', text: 'PASS' },
  { id: 'F.fail', section: 'F', kind: 'result', source: 'p2 L84', text: 'FAIL' },
  {
    id: 'F.note', section: 'F', kind: 'note', source: 'p2 L85',
    text: 'Relevant required pressure specification in AS2118.1, AS2118.4 and AS2118.6.',
  },
  { id: 'F.pressure', section: 'F', kind: 'label', source: 'p2 L86', text: 'Pressure' },
  { id: 'F.timeHeld', section: 'F', kind: 'label', source: 'p2 L86', text: 'Time held' },
  { id: 'F.comments', section: 'F', kind: 'label', source: 'p2 L87', text: 'Comments:' },

  // --- Part G --------------------------------------------------------------
  { id: 'G.band', section: 'G', kind: 'band', source: 'p2 L88', text: 'Part G—Sprinkler system flow test' },
  {
    id: 'G.note', section: 'G', kind: 'note', source: 'p2 L89-92',
    text: 'This section is to be used for sections 4.14 of AS2118.1-1999, 4 of AS2118.6-2012 and '
      + '6.2 of AS2118.4-2012 and section 2 of AS1851. Notes: (1) For AS2118.1 and AS2118.6 '
      + 'systems, multiple testing points may be required. (2) For AS2118.4, a simulated running '
      + 'test may be required for systems without a flow measuring device, in which the test '
      + 'involves opening a valve to discharge a volume of water that is accepted as being in '
      + 'excess of the design flow. System test points shall be noted for each different system '
      + 'and its location and descriptor.',
  },
  {
    id: 'G.spec', section: 'G', kind: 'label', source: 'p2 L93',
    text: 'System specifications (block plan):',
  },
  { id: 'G.results', section: 'G', kind: 'label', source: 'p2 L93', text: 'Test results:' },
  { id: 'G.point1', section: 'G', kind: 'label', source: 'p2 L94', text: 'Test point 1' },
  { id: 'G.location', section: 'G', kind: 'label', source: 'p2 L94', text: 'Location' },
  { id: 'G.requiredFlow', section: 'G', kind: 'label', source: 'p2 L95', text: 'Required flow rate' },
  { id: 'G.linePass', section: 'G', kind: 'tick', source: 'p2 L95', text: 'Pass' },
  { id: 'G.lineFail', section: 'G', kind: 'tick', source: 'p2 L95', text: 'Fail' },
  { id: 'G.requiredPressure', section: 'G', kind: 'label', source: 'p2 L96', text: 'Required pressure' },
  { id: 'G.point2', section: 'G', kind: 'label', source: 'p2 L97', text: 'Test point 2' },
  { id: 'G.runningTest', section: 'G', kind: 'label', source: 'p2 L100', text: 'Running test' },
  {
    id: 'G.installationGauge', section: 'G', kind: 'label', source: 'p2 L100',
    text: 'Installation gauge pressure:',
  },
  { id: 'G.comments', section: 'G', kind: 'label', source: 'p2 L101', text: 'Comments:' },

  // --- Part H --------------------------------------------------------------
  { id: 'H.band', section: 'H', kind: 'band', source: 'p2 L102', text: 'Part H—Compliance' },
  {
    id: 'H.critical', section: 'H', kind: 'label', source: 'p2 L103-104',
    text: 'Critical defects identified',
  },
  { id: 'H.criticalYes', section: 'H', kind: 'tick', source: 'p2 L105', text: 'Yes' },
  {
    id: 'H.criticalYesText', section: 'H', kind: 'label', source: 'p2 L105',
    text: 'Give owner/occupier a critical defect notice',
  },
  { id: 'H.criticalNo', section: 'H', kind: 'tick', source: 'p2 L106', text: 'No' },
  {
    id: 'H.criticalNoText', section: 'H', kind: 'label', source: 'p2 L106',
    text: 'No action required in relation to critical defects at this time',
  },
  {
    id: 'H.repairs', section: 'H', kind: 'label', source: 'p2 L107-108',
    text: 'Repairs/corrective actions taken',
  },
  {
    id: 'H.repairsYesText', section: 'H', kind: 'label', source: 'p2 L109',
    text: 'Attach details (including action and date taken) as part of Licensee’s report',
  },
  {
    id: 'H.repairsNoText', section: 'H', kind: 'label', source: 'p2 L110',
    text: 'No action required in relation to repairs/corrective actions at this time',
  },
  { id: 'H.system', section: 'H', kind: 'label', source: 'p2 L111', text: 'System' },
  { id: 'H.systemPass', section: 'H', kind: 'tick', source: 'p2 L111', text: 'Pass' },
  { id: 'H.systemFail', section: 'H', kind: 'tick', source: 'p2 L112', text: 'Fail' },

  // --- Part I --------------------------------------------------------------
  { id: 'I.band', section: 'I', kind: 'band', source: 'p2 L113', text: 'Part I—Signature' },
  {
    id: 'I.declaration', section: 'I', kind: 'note', source: 'p2 L114-115',
    text: 'By signing this Form 72, I confirm that the information contained herein is correct to '
      + 'the best of my knowledge given the information available and that this Form 72 has been '
      + 'completed in accordance with the relevant standards, codes and regulations.',
  },
  { id: 'I.licenseeName', section: 'I', kind: 'label', source: 'p2 L116', text: 'Licensee name' },
  { id: 'I.licenseeSignature', section: 'I', kind: 'label', source: 'p2 L116', text: 'Licensee signature' },
  { id: 'I.licenceNo', section: 'I', kind: 'label', source: 'p2 L117', text: 'Licence no. (QBCC/PIC)' },
  { id: 'I.reportNo', section: 'I', kind: 'label', source: 'p2 L117', text: 'Licensee report no.' },

  // --- the foot of the page ------------------------------------------------
  {
    id: 'footer.note', section: 'footer', kind: 'footer', source: 'p2 L118-120',
    text: 'Note: Building owners/occupiers are responsible for ensuring their buildings '
      + 'continuously meet fire safety standards. Where a building owner/occupier becomes aware '
      + 'that their building does not meet the minimum requirements for water pressure required '
      + 'by any standard applicable under the Queensland Development Code Mandatory Part 6.1 '
      + '(Maintenance of fire safety installations) the building owner/occupier should contact '
      + 'the Queensland Fire and Emergency Service.',
  },
  {
    id: 'footer.definitions', section: 'footer', kind: 'footer', source: 'p2 L121-122',
    text: 'Definitions → “Maintenance test” means a test that is required under a '
      + 'maintenance standard such as AS1851. “Running test” means a two inch waste '
      + 'test installed at the sprinkler control valve on older systems.',
  },
  {
    id: 'footer.privacy', section: 'footer', kind: 'footer', source: 'p2 L123-127',
    text: 'Privacy: The information on this form is collected for purposes related to monitoring '
      + 'compliance under the Plumbing and Drainage Act 2002, the Building Act 1975 and the '
      + 'Building Fire Safety Regulation 2008 (“legislation”). This information may be '
      + 'stored in the department’s database and may be used for statistical research, '
      + 'information provision and evaluation of Plumbing Industry Council and state government '
      + 'services. Your personal information may be disclosed to other government agencies, '
      + 'local government authorities and third parties for purposes related to this '
      + 'application. Except for these circumstances, personal information will only be '
      + 'disclosed to third parties with your consent or in accordance with the Information '
      + 'Privacy Act 2009.',
  },
  {
    id: 'footer.rti', section: 'footer', kind: 'footer', source: 'p2 L128-131',
    text: 'RTI: The information collected on this form will be retained as required by the Public '
      + 'Records Act 2002 and other relevant Acts and regulations, and is subject to the Right to '
      + 'Information regime established by the Right to Information Act 2009. If you have any '
      + 'further questions regarding your privacy, please email Building Codes Queensland on '
      + 'buildingcodes@qld.gov.au. © The State of Queensland (Department of Housing and Public '
      + 'Works) 2014. Published by the Queensland Government July 2014, 41 George Street, '
      + 'Brisbane QLD 4000.',
  },
  { id: 'footer.version', section: 'footer', kind: 'footer', source: 'p1 L70 / p2', text: 'Version 1 – July 2014' },
  {
    id: 'footer.imprintUnit', section: 'footer', kind: 'footer', source: 'p1 L71, p2 L132',
    text: 'Building Codes Queensland',
  },
  {
    id: 'footer.imprintDept', section: 'footer', kind: 'footer', source: 'p1 L72, p2 L133',
    text: 'Department of Housing and Public Works',
  },
];

export const OFFICIAL_FORM_72_UNITS: readonly OfficialUnit[] = [
  { id: 'B.boostPressure.kPa', section: 'B', field: 'Boost pressure', unit: 'kPa', source: 'p1 L23' },
  { id: 'B.testPressure.kPa', section: 'B', field: 'Test pressure', unit: 'kPa', source: 'p1 L23' },
  { id: 'B.duration.mins', section: 'B', field: 'Duration of test', unit: 'mins', source: 'p1 L24' },
  { id: 'B.endPressure.kPa', section: 'B', field: 'End of test pressure', unit: 'kPa', source: 'p1 L24' },
  { id: 'B.loss.Lpm', section: 'B', field: 'Loss (if any):', unit: 'L/min', source: 'p1 L24' },
  { id: 'D.requirements.Lps', section: 'D', field: 'System requirements', unit: 'L/s', source: 'p1 L43' },
  { id: 'D.requirements.kPa', section: 'D', field: 'System requirements', unit: 'kPa', source: 'p1 L43' },
  { id: 'D.static.kPa', section: 'D', field: 'Static pressure', unit: 'kPa', source: 'p1 L43' },
  { id: 'D.row19.kPa', section: 'D', field: '19 mm', unit: 'kPa', source: 'p1 L59' },
  { id: 'D.row22.kPa', section: 'D', field: '22 mm', unit: 'kPa', source: 'p1 L60' },
  { id: 'D.row25.kPa', section: 'D', field: '25 mm', unit: 'kPa', source: 'p1 L61' },
  { id: 'D.row5.kPa', section: 'D', field: '5 L/s', unit: 'kPa', source: 'p1 L64' },
  { id: 'D.row10.kPa', section: 'D', field: '10 L/s', unit: 'kPa', source: 'p1 L65' },
  { id: 'D.row15.kPa', section: 'D', field: '15 L/s', unit: 'kPa', source: 'p1 L66' },
  { id: 'D.row20.kPa', section: 'D', field: '20 L/s', unit: 'kPa', source: 'p1 L67' },
  { id: 'D.row30.kPa', section: 'D', field: '30 L/s', unit: 'kPa', source: 'p1 L68' },
  { id: 'D.achieved.Lps', section: 'D', field: 'System achieved:', unit: 'L/s', source: 'p1 L69' },
  { id: 'D.achieved.kPa', section: 'D', field: 'System achieved:', unit: 'kPa', source: 'p1 L69' },
  { id: 'E.height.m', section: 'E', field: 'Height of highest hydrant above booster', unit: 'm', source: 'p2 L79' },
  { id: 'E.requirements.Lps', section: 'E', field: 'System requirements', unit: 'L/s', source: 'p2 L80' },
  { id: 'E.requirements.kPa', section: 'E', field: 'System requirements', unit: 'kPa', source: 'p2 L80' },
  { id: 'E.static.kPa', section: 'E', field: 'Static pressure', unit: 'kPa', source: 'p2 L80' },
  { id: 'E.inlet.kPa', section: 'E', field: 'Pump inlet pressure', unit: 'kPa', source: 'p2 L81' },
  { id: 'E.discharge.kPa', section: 'E', field: 'Pump discharge pressure', unit: 'kPa', source: 'p2 L81' },
  { id: 'E.boost.kPa', section: 'E', field: 'Boost pressure', unit: 'kPa', source: 'p2 L82' },
  { id: 'E.friction.kPa', section: 'E', field: 'Calculated frictional loss', unit: 'kPa', source: 'p2 L82' },
  { id: 'F.pressure.kPa', section: 'F', field: 'Pressure', unit: 'kPa', source: 'p2 L86' },
  { id: 'F.timeHeld.mins', section: 'F', field: 'Time held', unit: 'mins', source: 'p2 L86' },
  { id: 'G.requiredFlow.Lpm', section: 'G', field: 'Required flow rate', unit: 'L/min', source: 'p2 L95' },
  { id: 'G.requiredPressure.kPa', section: 'G', field: 'Required pressure', unit: 'kPa', source: 'p2 L96' },
  { id: 'G.installationGauge.kPa', section: 'G', field: 'Installation gauge pressure:', unit: 'kPa', source: 'p2 L100' },
];
