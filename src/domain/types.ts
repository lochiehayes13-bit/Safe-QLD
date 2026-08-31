/**
 * Safe QLD domain model.
 *
 * Deliberately panel-agnostic. Every supported panel brand gets normalised into
 * these shapes by a parser plugin, which means the UI, exports, test sheets and
 * cause-and-effect tooling are written once and work for every brand — including
 * sites a tech builds by hand with no config file at all.
 */

export type PanelBrand =
  | 'ampac'
  | 'vigilant'
  | 'notifier'
  | 'pertronic'
  | 'simplex'
  | 'siemens'
  | 'fusion'
  | 'brooks'
  | 'kentec'
  | 'other';

export interface PanelModelInfo {
  brand: PanelBrand;
  /** Marketing model name, e.g. "FireFinder PLUS", "MX1", "4100ES". */
  model: string;
  /** Loop/SLC protocol the panel drives, where known. */
  protocol?: AddressProtocol;
  maxLoops?: number;
  maxZones?: number;
  notes?: string;
}

/** Addressable loop protocols relevant to Australian installs. */
export type AddressProtocol =
  | 'apollo-xp95'
  | 'apollo-discovery'
  | 'apollo-core'
  | 'hochiki-esp'
  | 'system-sensor'
  | 'simplex-idnet'
  | 'tyco-mx'
  | 'ampac'
  | 'conventional'
  | 'generic';

// ---------------------------------------------------------------------------
// Site / panel structure
// ---------------------------------------------------------------------------

export interface Site {
  id: string;
  name: string;
  address?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  clientName?: string;
  /** Free-form site/job reference used by the tech's employer. */
  siteRef?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Panel {
  id: string;
  siteId: string;
  name: string;
  brand: PanelBrand;
  model?: string;
  /** Node/panel number within a networked site (MX1 networks, Simplex networks). */
  nodeNumber?: number;
  location?: string;
  firmware?: string;
  /** Where this panel's data came from. */
  source: DataSource;
  createdAt: string;
  updatedAt: string;
}

export type DataSource =
  /** Typed in by hand in the app. */
  | 'manual'
  /** Parsed from a vendor config/site file. */
  | 'config-import'
  /** Imported from CSV/XLSX. */
  | 'tabular-import'
  /** Received as a Safe QLD share pack. */
  | 'shared-pack';

export interface Loop {
  id: string;
  panelId: string;
  /** Loop number as the panel labels it (1-based). */
  number: number;
  label?: string;
  protocol?: AddressProtocol;
  /** Measured or design loop current in mA, used by the loop budget tool. */
  measuredCurrentMa?: number;
}

export interface Zone {
  id: string;
  panelId: string;
  /** Zone number as displayed on the panel. */
  number: number;
  /** Zone text as programmed. This is what techs search on. */
  text: string;
  /** Some panels carry a second descriptor line. */
  text2?: string;
  type?: string;
  /** True when the zone exists in the config but has no devices / is unused. */
  unused: boolean;
}

/**
 * A point is any addressable thing on a panel: detector, MCP, module, sounder,
 * relay, input. Named "point" to match panel terminology across brands.
 */
export interface Point {
  id: string;
  panelId: string;
  loopNumber?: number;
  /** Address on the loop. */
  address?: number;
  /** Sub-address / channel for multi-channel modules. */
  subAddress?: number;
  /** The panel's own point identifier string, e.g. "L1P034" or "M1-1-34". */
  pointRef?: string;
  /** Device text / location description as programmed. */
  text: string;
  text2?: string;
  /** Raw device type string from the config, preserved verbatim. */
  deviceTypeRaw?: string;
  /** Normalised device class for filtering and test sheets. */
  deviceType: DeviceType;
  /** Zone number this point reports to. */
  zoneNumber?: number;
  /** Denormalised zone text — the single most useful thing on a point list. */
  zoneText?: string;
  unused: boolean;
}

export type DeviceType =
  | 'smoke'
  | 'smoke-photo'
  | 'smoke-ion'
  | 'heat'
  | 'multi'
  | 'beam'
  | 'aspirating'
  | 'flame'
  | 'duct'
  | 'mcp'
  | 'sounder'
  | 'sounder-strobe'
  | 'strobe'
  | 'module-input'
  | 'module-output'
  | 'module-io'
  | 'relay'
  | 'isolator'
  | 'sprinkler-flow'
  | 'sprinkler-valve'
  | 'gas'
  | 'wip'
  | 'door-holder'
  | 'unknown';

// ---------------------------------------------------------------------------
// Cause and effect
// ---------------------------------------------------------------------------

export interface CauseEffectRule {
  id: string;
  panelId: string;
  /** Short label, e.g. "Zone 12 Alarm". */
  causeLabel: string;
  causeKind: CauseKind;
  /** Zone/point this cause refers to, when it maps to config. */
  causeZoneNumber?: number;
  causePointRef?: string;
  effects: CauseEffect[];
  /** Verbatim panel logic (Simplex Custom Control, Vigilant equation, etc.). */
  sourceLogic?: string;
  notes?: string;
}

export type CauseKind =
  | 'zone-alarm'
  | 'point-alarm'
  | 'mcp'
  | 'sprinkler-flow'
  | 'gas-release'
  | 'aspirating-alert'
  | 'aspirating-action'
  | 'aspirating-fire1'
  | 'aspirating-fire2'
  | 'fault'
  | 'isolate'
  | 'manual'
  | 'other';

export interface CauseEffect {
  id: string;
  effectLabel: string;
  effectKind: EffectKind;
  /** Delay before the effect operates, in seconds. */
  delaySeconds?: number;
  state: CellState;
}

export type EffectKind =
  | 'occupant-warning'
  | 'evacuation'
  | 'sounders'
  | 'strobes'
  | 'brigade-signal'
  | 'ahu-shutdown'
  | 'lift-homing'
  | 'door-release'
  | 'damper-close'
  | 'gas-release'
  | 'smoke-control'
  | 'pressurisation'
  | 'plant-shutdown'
  | 'relay-output'
  | 'other';

/** Matrix cell state. Tri-state so a matrix can record "explicitly not linked". */
export type CellState = 'operates' | 'not-linked' | 'conditional';

// ---------------------------------------------------------------------------
// Service / testing
// ---------------------------------------------------------------------------

export type ServiceFrequency =
  | 'monthly'
  | 'quarterly'
  | 'six-monthly'
  | 'annual'
  | 'five-yearly'
  | 'commissioning'
  | 'ad-hoc';

export interface ServiceReport {
  id: string;
  siteId: string;
  /** Optional: a report can span every panel on a networked site. */
  panelId?: string;
  title: string;
  frequency: ServiceFrequency;
  /** ISO date the work was performed. */
  serviceDate: string;
  technicianName?: string;
  technicianLicence?: string;
  companyName?: string;
  /** Person who signed on site. */
  witnessName?: string;
  /** Base64 PNG signature captured on device. */
  signatureTechnician?: string;
  signatureWitness?: string;
  status: 'draft' | 'complete';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type TestResult = 'pass' | 'fail' | 'na' | 'untested';

export interface TestRow {
  id: string;
  reportId: string;
  /** Link back to the point, when the row came from a config. */
  pointId?: string;
  /** Denormalised so a report stays readable even if the config is deleted. */
  pointRef?: string;
  loopNumber?: number;
  address?: number;
  zoneNumber?: number;
  zoneText?: string;
  deviceText: string;
  deviceType: DeviceType;
  result: TestResult;
  /** Test method used, e.g. "Smoke aerosol", "Heat gun", "Magnet". */
  method?: string;
  comment?: string;
  /** ISO timestamp the row was marked. */
  testedAt?: string;
  /** Ordering within the report. */
  sortIndex: number;
}

/** A checklist item on a report that is not tied to a device (panel checks, batteries, etc.). */
export interface CheckRow {
  id: string;
  reportId: string;
  section: string;
  label: string;
  result: TestResult;
  /** For rows that record a measurement rather than a pass/fail. */
  value?: string;
  unit?: string;
  comment?: string;
  sortIndex: number;
}

export type DefectSeverity = 'critical' | 'non-critical';
export type DefectStatus = 'open' | 'rectified' | 'quoted' | 'closed';

export interface Defect {
  id: string;
  siteId: string;
  reportId?: string;
  pointId?: string;
  /** Denormalised location text so the defect reads standalone. */
  location: string;
  description: string;
  severity: DefectSeverity;
  status: DefectStatus;
  raisedAt: string;
  rectifiedAt?: string;
  /** Local file URIs of attached photos. */
  photos: string[];
  notes?: string;

  // --- Queensland statutory fields -----------------------------------------
  /** The library code this defect was raised from. */
  defectCode?: string;
  /** AS 1851 classification, which is not the same test as the Queensland one. */
  as1851Class?: 'critical' | 'non-critical' | 'non-conformance';
  /** Limb (a): the defect renders the installation inoperable. */
  qldLimbInoperable?: boolean;
  /** Limb (b): reasonably likely to significantly affect occupant safety. */
  qldLimbAdverseImpact?: boolean;
  /** When the written notice was given to the occupier. */
  noticeIssuedAt?: string;
  noticeRecipient?: string;
  /** Verbal notification before leaving site. */
  verbalNotifiedAt?: string;
  verbalNotifiedTo?: string;
  /** One month from the maintenance. */
  rectificationDueAt?: string;
  interimMeasures?: string;
  /** Zones, floors or devices affected — supports the limb (b) judgement. */
  extentOfImpairment?: string;
}

// ---------------------------------------------------------------------------
// Import / parse results
// ---------------------------------------------------------------------------

/** What a parser plugin returns. Normalised, panel-agnostic. */
export interface ParsedConfig {
  brand: PanelBrand;
  model?: string;
  /** Detected site name from the config, if any. */
  siteName?: string;
  panels: ParsedPanel[];
  warnings: string[];
  /** Parser identifier + version, recorded for traceability. */
  parser: string;
}

export interface ParsedPanel {
  name: string;
  brand: PanelBrand;
  model?: string;
  nodeNumber?: number;
  zones: Omit<Zone, 'id' | 'panelId'>[];
  points: Omit<Point, 'id' | 'panelId'>[];
  loops: Omit<Loop, 'id' | 'panelId'>[];
  causeEffect: Omit<CauseEffectRule, 'id' | 'panelId'>[];
}
